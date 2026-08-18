import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

try {
  const theme = localStorage.getItem("aether.theme") || "retro";
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = "retro";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
