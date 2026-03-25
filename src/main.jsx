import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/** Claude 아티팩트용 API → 브라우저에서는 localStorage로 대체 */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      try {
        const v = localStorage.getItem(key);
        if (v == null) return null;
        return { value: v };
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
