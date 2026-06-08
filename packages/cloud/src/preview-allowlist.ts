/**
 * Suffixes of hostnames that get the `preview` origin tier without DNS
 * verification. Adding a new suffix is a security-sensitive change:
 * anyone who can register a subdomain on the listed platform can
 * provision an AuthAI publishable app for their subdomain, bypassing
 * the implicit "you control the origin" assumption.
 *
 * CODEOWNERS protects this file. Reviewers should ask:
 *   1. Is the platform's subdomain allocation gated (signup required) or
 *      open (anyone can grab a subdomain)?
 *   2. Does the platform let subdomain holders set arbitrary response
 *      headers (so they can run real-looking AuthAI sign-in flows)?
 *   3. Has anyone reported abuse on this platform's allowlist entry?
 *
 * Suffixes are matched as `host.endsWith("." + suffix)` after
 * normalizeOrigin() strips the scheme + port.
 */
export const PREVIEW_HOST_SUFFIXES: readonly string[] = [
  "lovable.app",
  "v0.dev",
  "bolt.new",
  "stackblitz.io",
  "codesandbox.io",
  "repl.co",
  "vercel.app",
  "netlify.app",
] as const;
