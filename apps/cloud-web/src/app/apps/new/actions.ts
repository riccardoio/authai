"use server";

import { ulid } from "ulid";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFullStore } from "@/lib/db";
import {
  classifyOriginTier,
  normalizeOrigin,
  hashApiKey,
  generatePublishableKey,
} from "@authai/cloud";

const BLOCKED_HOSTS = ["authai.io", "relay.authai.io", "www.authai.io"];

export async function createPublishableAppAction(input: {
  origin: string;
  name: string;
}): Promise<{ redirect?: string; error?: string }> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?return=/apps/new");
  }

  // Validate + normalize origin.
  let normalized: string;
  let url: URL;
  try {
    normalized = normalizeOrigin(input.origin);
    if (!normalized) throw new Error("malformed");
    url = new URL(normalized);
    if (BLOCKED_HOSTS.includes(url.hostname)) {
      return { error: "Origin cannot be authai.io or its subdomains." };
    }
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.hostname.endsWith(".local")
    ) {
      return { error: "Production origins must use https://." };
    }
  } catch {
    return { error: "Origin must be a valid URL like https://my-app.com." };
  }

  if (!input.name.trim()) {
    return { error: "Name is required." };
  }

  const tier = classifyOriginTier(normalized);
  const appId = `app_${ulid().toLowerCase()}`;
  const pkPlain = generatePublishableKey();
  const pkHash = hashApiKey(pkPlain);

  // The apps table requires api_key_hash + origin (both UNIQUE).
  // Publishable apps don't use a secret key; we store a deterministic
  // placeholder so the UNIQUE constraint is satisfied without leaking a
  // usable secret into the DB.
  const placeholderApiKeyHash = hashApiKey(`unused-publishable-${appId}`);

  const store = await getFullStore();

  try {
    await store.apps.create({
      id: appId,
      apiKeyHash: placeholderApiKeyHash,
      origin: normalized,
      name: input.name.trim(),
      ownerGithubId: session.githubUserId,
      ownerEmail: session.githubEmail,
      originVerifyToken: "unused-publishable",
      credentialType: "publishable",
    });
    await store.origins.add({ appId, origin: normalized, tier });
    await store.publishableKeys.create({
      appId,
      keyHash: pkHash,
      label: "initial",
      createdBy: session.githubUserId,
    });
  } catch (err: unknown) {
    const isUniqueViolation =
      typeof err === "object" &&
      err !== null &&
      (("code" in err && (err as { code: unknown }).code === "23505") ||
        ("message" in err &&
          typeof (err as { message: unknown }).message === "string" &&
          (err as { message: string }).message.includes("UNIQUE")));
    if (isUniqueViolation) {
      return {
        error: `Origin ${normalized} is already registered to another AuthAI app. Contact support if you own this domain.`,
      };
    }
    throw err;
  }

  return {
    redirect: `/apps/${appId}/created?type=publishable&pk=${encodeURIComponent(pkPlain)}`,
  };
}
