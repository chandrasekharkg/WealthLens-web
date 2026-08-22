import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element — index.html and this entry point disagree");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
