import "./polyfills";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Dynamic import AFTER the polyfill: ESM imports are hoisted, so a static
// `import "./App"` here would run before the Buffer polyfill is installed.
void import("./App").then(({ App }) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
