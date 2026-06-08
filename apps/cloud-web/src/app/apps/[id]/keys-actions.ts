"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getFullStore } from "@/lib/db";
import { generatePublishableKey, hashApiKey } from "@authai/cloud";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

const MAX_ACTIVE_KEYS = 3;

async function checkCsrf(token: string, action: string): Promise<boolean> {
  const sc = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "";
  return verifyCsrf({ token, sessionCookieValue: sc, action });
}

async function assertOwner(appId: string): Promise<{ githubUserId: string }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const store = await getFullStore();
  const app = await store.apps.getById(appId);
  if (!app) throw new Error("App not found");
  if (app.ownerGithubId !== session.githubUserId) throw new Error("Not your app");
  return { githubUserId: session.githubUserId };
}

export async function rotateKeyAction(
  appId: string,
  label: string | null,
  csrf: string,
): Promise<{ plaintext?: string; error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "keys.rotate"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();
  const app = await store.apps.getById(appId);
  if (!app || app.credentialType !== "publishable") {
    return { error: "Only publishable apps support key rotation." };
  }

  const existing = await store.publishableKeys.listForApp(appId);
  const active = existing.filter((k) => k.status === "active");
  if (active.length >= MAX_ACTIVE_KEYS) {
    return {
      error: `Max ${MAX_ACTIVE_KEYS} active keys per app. Revoke one before creating another.`,
    };
  }

  const plaintext = generatePublishableKey();
  const keyHash = hashApiKey(plaintext);
  const key = await store.publishableKeys.create({
    appId,
    keyHash,
    label: label ?? undefined,
    createdBy: githubUserId,
  });

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "keys.create",
    payload: { keyId: key.id, label },
  });

  return { plaintext };
}

export async function revokeKeyAction(
  appId: string,
  keyId: string,
  csrf: string,
): Promise<{ error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "keys.revoke"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();
  const ok = await store.publishableKeys.revokeForApp(appId, keyId, githubUserId);
  if (!ok) return { error: "Key not found." };

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "keys.revoke",
    payload: { keyId },
  });

  return {};
}
