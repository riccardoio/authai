/**
 * AUTH_AI_EDITION env var resolution. The cloud package itself doesn't
 * read process.env directly — it accepts the resolved Edition from the
 * deploy app (apps/cloud-relay-server). This keeps the package pure and
 * testable.
 */

export type Edition = "community" | "cloud";

export function resolveEdition(raw: string | undefined): Edition {
  const normalized = (raw ?? "community").toLowerCase().trim();
  if (normalized === "cloud") return "cloud";
  if (normalized === "" || normalized === "community" || normalized === "self-hosted") {
    return "community";
  }
  throw new Error(
    `unknown AUTH_AI_EDITION value: ${raw} (expected "community" or "cloud")`,
  );
}
