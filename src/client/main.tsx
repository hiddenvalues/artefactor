import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import App from "./App";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

createRoot(target).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
