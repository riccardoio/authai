"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-submits a server-rendered form on mount. Lives in a Client
 * Component because:
 *   - Server-rendered `<script dangerouslySetInnerHTML>` tags don't
 *     execute reliably in Next.js App Router's streaming pipeline —
 *     they can render to the document but never run, or run before the
 *     target form exists in the DOM.
 *   - `useEffect` runs once after hydration completes, which is the
 *     moment we know the form is in the DOM and submittable.
 *
 * The user sees a button + JS-triggered submit. If JS is disabled, the
 * button is still clickable. If the listener has died, the browser
 * surfaces the connection error and the user can still copy the key
 * from the fallback code block on the page.
 */
export function AutoSubmit({ formId }: { formId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // StrictMode double-invoke guard.
    fired.current = true;
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) {
      form.submit();
    }
  }, [formId]);
  return null;
}
