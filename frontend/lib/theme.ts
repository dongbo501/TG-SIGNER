"use client";
import { useEffect, useState } from "react";

const storageKey = "tg-signer-theme";
type Scheme = "light" | "dark";

function savedScheme(): Scheme | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function useTheme() {
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    // In-memory choice still works when browser storage is unavailable.
    let override = savedScheme();
    const apply = () => {
      const scheme = override ?? (system.matches ? "dark" : "light");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", override ?? "light dark");
      setDarkMode(scheme === "dark");
    };
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        override = savedScheme();
        apply();
      }
    };
    const toggle = () => {
      const current = override ?? (system.matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      override = next === (system.matches ? "dark" : "light") ? null : next;
      try {
        if (override) localStorage.setItem(storageKey, override);
        else localStorage.removeItem(storageKey);
      } catch {
        /* The current page can still change theme. */
      }
      apply();
    };
    apply();
    system.addEventListener("change", apply);
    window.addEventListener("storage", storage);
    window.addEventListener("tg-signer-toggle-theme", toggle);
    return () => {
      system.removeEventListener("change", apply);
      window.removeEventListener("storage", storage);
      window.removeEventListener("tg-signer-toggle-theme", toggle);
    };
  }, []);
  return {
    darkMode,
    toggleTheme: () =>
      window.dispatchEvent(new Event("tg-signer-toggle-theme")),
  };
}
