import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Run @testing-library/react cleanup after every test. Required because
// vitest.config.ts has globals:false, so the library's auto-cleanup (which
// relies on a global afterEach) doesn't fire on its own.
afterEach(() => { cleanup(); });

// jsdom does not implement window.matchMedia — polyfill it so Dialog.tsx renders.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
