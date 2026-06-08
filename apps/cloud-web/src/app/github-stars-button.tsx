"use client";

import { useEffect, useState } from "react";

const REPO = "riccardoio/authai";
const CACHE_KEY = "authai:gh-stars:v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Live GitHub-stars pill. Fetches the public unauthenticated repo
 * endpoint (rate-limited to 60 req/hour/IP — well above what one
 * landing view costs) and caches the count in localStorage with a
 * 1h TTL. Falls back to "Star on GitHub" if the fetch fails or
 * times out, so the CTA stays clickable and the page never shows
 * an "0 stars" or "—" placeholder while resolving.
 */
export function GitHubStarsButton() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    // Cache first — render instantly if we have a recent value.
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { count, fetchedAt } = JSON.parse(raw) as {
          count: number;
          fetchedAt: number;
        };
        if (Date.now() - fetchedAt < CACHE_TTL_MS) {
          setStars(count);
          return;
        }
      }
    } catch {}

    let cancelled = false;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);

    fetch(`https://api.github.com/repos/${REPO}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const count = data?.stargazers_count;
        if (typeof count === "number") {
          setStars(count);
          try {
            window.localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({ count, fetchedAt: Date.now() }),
            );
          } catch {}
        }
      })
      .catch(() => {
        /* network error / rate-limited — keep the static fallback */
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <a
      className="landing-btn-ghost landing-stars-btn"
      href={`https://github.com/${REPO}`}
      target="_blank"
      rel="noreferrer"
    >
      <StarIcon />
      {stars !== null ? (
        <>
          <span className="landing-stars-count">{formatStars(stars)}</span>
          <span className="landing-stars-label">on GitHub</span>
        </>
      ) : (
        <span className="landing-stars-label">Star on GitHub</span>
      )}
    </a>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

function formatStars(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}
