import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./ui/App";
import { useStore, live } from "./ui/store";

import { downloadReport } from "./ui/report";

// test hooks for scripts/e2e.mjs (development server only)
if (import.meta.env.DEV) Object.assign(window, { __store: useStore, __live: live, __report: downloadReport });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
