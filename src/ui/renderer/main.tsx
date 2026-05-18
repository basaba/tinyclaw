import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installWebBridge } from "./api/web-bridge";
import "./styles.css";

installWebBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
