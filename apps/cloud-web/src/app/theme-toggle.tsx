"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "authai:theme";
type Mode = "light" | "dark";

/**
 * Wraps a chunk of content with a `data-theme` attribute that toggles
 * between light and dark, persisted to localStorage. The demo-react
 * demo did the same — we keep the storage key under an `authai:` prefix
 * so it doesn't collide with the demo's `authai-demo:theme` key on
 * shared origins.
 */
export function ThemeRoot({ children }: { children: (props: {
  mode: Mode;
  toggle: () => void;
}) => React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  // Hydrate from localStorage AFTER mount — keeps server + client first
  // paint identical (both render light) and avoids the "flash of wrong
  // theme" hydration warning.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") setMode(stored);
    } catch {
      /* localStorage may throw in private mode */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* noop */
    }
  }, [mode]);

  const toggle = () => setMode(mode === "dark" ? "light" : "dark");
  return <>{children({ mode, toggle })}</>;
}

export function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
