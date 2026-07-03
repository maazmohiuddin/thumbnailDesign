import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { store } from "./state/store";
import { fontsReady } from "./fonts";
import "./styles.css";

void fontsReady();
void store.restore();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
