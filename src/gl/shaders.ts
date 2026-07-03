/** Shared vertex shader: unit quad → px space → matrix → Inner coords → clip space. */
export const VERT_SRC = `
attribute vec2 a_pos;
uniform vec2 u_size;
uniform mat3 u_matrix;
uniform vec2 u_innerOffset;
uniform vec2 u_canvasSize;
varying vec2 v_uv;
void main() {
  vec2 p = (u_matrix * vec3(a_pos * u_size, 1.0)).xy + u_innerOffset;
  vec2 clip = vec2(p.x / u_canvasSize.x * 2.0 - 1.0, 1.0 - p.y / u_canvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_pos;
}
`;

/**
 * Base-image fragment shader. Adjustments applied in this exact order:
 * exposure → temperature → tint → contrast → highlights → shadows → saturation.
 * All uniforms are normalized to −1…+1 (UI −100…+100).
 */
export const IMAGE_FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_exposure;
uniform float u_temperature;
uniform float u_tint;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_saturation;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;

  // 1. Exposure — multiplicative gain in linear-ish space.
  c *= pow(2.0, u_exposure * 1.5);

  // 2. Temperature — warm shifts R up / B down, cool the inverse.
  c.r += u_temperature * 0.12;
  c.b -= u_temperature * 0.12;

  // 3. Tint — green/magenta axis on the G channel.
  c.g += u_tint * 0.12;

  // 4. Contrast — pivot around 0.5.
  c = (c - 0.5) * (1.0 + u_contrast * 0.8) + 0.5;

  // 5. Highlights — gain masked to luminance above ~0.6.
  float lumaH = dot(clamp(c, 0.0, 1.0), LUMA);
  float hmask = smoothstep(0.45, 0.8, lumaH);
  c += c * u_highlights * 0.45 * hmask;

  // 6. Shadows — lift/crush masked to luminance below ~0.4.
  float lumaS = dot(clamp(c, 0.0, 1.0), LUMA);
  float smask = 1.0 - smoothstep(0.2, 0.55, lumaS);
  c += u_shadows * 0.3 * smask * (1.0 - clamp(c, 0.0, 1.0));

  // 7. Saturation — mix between luminance grey and color.
  float g = dot(clamp(c, 0.0, 1.0), LUMA);
  c = mix(vec3(g), c, 1.0 + u_saturation);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** Overlay fragment shader: plain premultiplied-alpha texture. */
export const OVERLAY_FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv);
}
`;
