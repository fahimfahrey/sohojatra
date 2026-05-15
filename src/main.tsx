import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerNotificationServiceWorker } from "./lib/pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register service worker for notifications and PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Register the notification service worker (your existing sw.js)
    registerNotificationServiceWorker();
  });
}
