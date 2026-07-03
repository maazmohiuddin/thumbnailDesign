import { CANVAS_H, CANVAS_W, INNER_H, INNER_W, INNER_X, INNER_Y } from "../template";
import { imageToInnerMatrix } from "../transform";
import type { AdjustState, TransformState } from "../state/types";
import { IMAGE_FRAG_SRC, OVERLAY_FRAG_SRC, VERT_SRC } from "./shaders";

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

interface ProgramInfo {
  program: WebGLProgram;
  aPos: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/**
 * The single shared WebGL pipeline. The backing store is always the native
 * 1015 × 1920 template space (preview scales it with CSS only), so calling
 * `toBlob` on the same canvas that the user previews guarantees preview and
 * export are pixel-identical.
 *
 * Draw order per render: clear black → scissor to the Inner frame →
 * base image (transform + adjustments) → locked overlay texture.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private gl: GL;
  private isGL2: boolean;
  private imageProg: ProgramInfo;
  private overlayProg: ProgramInfo;
  private quad: WebGLBuffer;
  private imageTex: WebGLTexture | null = null;
  private overlayTex: WebGLTexture | null = null;
  private imageW = 0;
  private imageH = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const opts: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
    };
    const gl2 = canvas.getContext("webgl2", opts) as WebGL2RenderingContext | null;
    const gl = gl2 ?? (canvas.getContext("webgl", opts) as WebGLRenderingContext | null);
    if (!gl) throw new Error("WebGL is not available in this browser.");
    this.gl = gl;
    this.isGL2 = !!gl2;

    this.imageProg = this.buildProgram(VERT_SRC, IMAGE_FRAG_SRC, [
      "u_size",
      "u_matrix",
      "u_innerOffset",
      "u_canvasSize",
      "u_tex",
      "u_exposure",
      "u_temperature",
      "u_tint",
      "u_contrast",
      "u_highlights",
      "u_shadows",
      "u_saturation",
    ]);
    this.overlayProg = this.buildProgram(VERT_SRC, OVERLAY_FRAG_SRC, [
      "u_size",
      "u_matrix",
      "u_innerOffset",
      "u_canvasSize",
      "u_tex",
    ]);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.quad = quad;

    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  private buildProgram(vs: string, fs: string, uniformNames: string[]): ProgramInfo {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, aPos: gl.getAttribLocation(program, "a_pos"), uniforms };
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
  }

  /** Upload / replace the base image texture (image, canvas, bitmap, or live video element). */
  setImage(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    if (!this.imageTex) this.imageTex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (this.isGL2) {
      // Trilinear minification for large stills (WebGL2 allows NPOT mipmaps).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      (gl as WebGL2RenderingContext).generateMipmap(gl.TEXTURE_2D);
    }
    this.imageW = width;
    this.imageH = height;
  }

  /** Upload / replace the locked-layers overlay (a 1015 × 1350 2D canvas). */
  setOverlay(source: HTMLCanvasElement): void {
    const gl = this.gl;
    if (!this.overlayTex) this.overlayTex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  hasImage(): boolean {
    return !!this.imageTex && this.imageW > 0;
  }

  render(transform: TransformState, adjust: AdjustState): void {
    if (this.disposed) return;
    const gl = this.gl;
    gl.viewport(0, 0, CANVAS_W, CANVAS_H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // The Inner frame clips all content. (Vertically centered: 285px bars top
    // and bottom, so the GL bottom-origin scissor rect matches the CSS one.)
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(INNER_X, CANVAS_H - INNER_Y - INNER_H, INNER_W, INNER_H);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);

    if (this.imageTex && this.imageW > 0) {
      const p = this.imageProg;
      gl.useProgram(p.program);
      gl.enableVertexAttribArray(p.aPos);
      gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
      gl.uniform1i(p.uniforms.u_tex, 0);
      gl.uniform2f(p.uniforms.u_size, this.imageW, this.imageH);
      gl.uniformMatrix3fv(p.uniforms.u_matrix, false, imageToInnerMatrix(transform, this.imageW, this.imageH));
      gl.uniform2f(p.uniforms.u_innerOffset, INNER_X, INNER_Y);
      gl.uniform2f(p.uniforms.u_canvasSize, CANVAS_W, CANVAS_H);
      gl.uniform1f(p.uniforms.u_exposure, adjust.exposure / 100);
      gl.uniform1f(p.uniforms.u_temperature, adjust.temperature / 100);
      gl.uniform1f(p.uniforms.u_tint, adjust.tint / 100);
      gl.uniform1f(p.uniforms.u_contrast, adjust.contrast / 100);
      gl.uniform1f(p.uniforms.u_highlights, adjust.highlights / 100);
      gl.uniform1f(p.uniforms.u_shadows, adjust.shadows / 100);
      gl.uniform1f(p.uniforms.u_saturation, adjust.saturation / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (this.overlayTex) {
      const p = this.overlayProg;
      gl.useProgram(p.program);
      gl.enableVertexAttribArray(p.aPos);
      gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.uniform1i(p.uniforms.u_tex, 0);
      gl.uniform2f(p.uniforms.u_size, INNER_W, INNER_H);
      gl.uniformMatrix3fv(p.uniforms.u_matrix, false, IDENTITY);
      gl.uniform2f(p.uniforms.u_innerOffset, INNER_X, INNER_Y);
      gl.uniform2f(p.uniforms.u_canvasSize, CANVAS_W, CANVAS_H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disable(gl.SCISSOR_TEST);
  }

  /** Encode the current 1015 × 1920 composite. Callers must render() first. */
  toBlob(type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Export encoding failed."))),
        type,
        quality
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    const gl = this.gl;
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    if (this.overlayTex) gl.deleteTexture(this.overlayTex);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.imageProg.program);
    gl.deleteProgram(this.overlayProg.program);
  }
}
