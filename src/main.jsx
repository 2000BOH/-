import React from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import App from "./App.jsx";
import { createSupabaseBackedStorage } from "./supabaseStorage.js";

const localStorageShim = {
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

/** VITE_SUPABASE_* 가 있으면 Supabase, 없으면 localStorage */
if (typeof window !== "undefined" && !window.storage) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anon) {
    const supabase = createClient(url, anon);
    window.storage = createSupabaseBackedStorage(supabase);
    window.__JANGBAK_STORAGE__ = "supabase";
  } else {
    window.storage = localStorageShim;
    window.__JANGBAK_STORAGE__ = "local";
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
