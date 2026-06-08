"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getFullStore } from "@/lib/db";
import { classifyOriginTier, normalizeOrigin } from "@authai/cloud";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

const BLOCKED_HOSTS = ["authai.io", "relay.authai.io", "www.authai.io"];

async function assertOwner(appId: string): Promise<{ githubUserId: string }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const store = await getFullStore();
  const app = await store.apps.getById(appId);
  if (!app) throw new Error("App not found");
  if (app.ownerGithubId !== session.githubUserId) throw new Error("Not your app");
  return { githubUserId: session.githubUserId };
}

async function checkCsrf(token: string, action: string): Promise<boolean> {
  const sc = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "";
  return verifyCsrf({ token, sessionCookieValue: sc, action });
}

export async function addOriginAction(
  appId: string,
  originRaw: string,
  csrf: string,
): Promise<{ error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "origins.add"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();

  let origin: string;
  try {
    origin = normalizeOrigin(originRaw);
    if (!origin) throw new Error();
    const url = new URL(origin);
    if (BLOCKED_HOSTS.includes(url.hostname)) {
      return { error: "Origin cannot be authai.io." };
    }
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.hostname.endsWith(".local")
    ) {
      return { error: "Production origins must use https://." };
    }
  } catch {
    return { error: "Invalid origin URL." };
  }

  const tier = classifyOriginTier(origin);
  try {
    await store.origins.add({ appId, origin, tier });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE") || err.code === "23505") {
      return { error: "That origin is already registered to another app." };
    }
    throw err;
  }

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "origins.add",
    payload: { origin, tier },
  });

  return {};
}

export async function disableOriginAction(
  appId: string,
  originId: string,
  csrf: string,
): Promise<{ error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "origins.disable"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();
  await store.origins.setStatus(originId, "disabled");

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "origins.disable",
    payload: { originId },
  });

  return {};
}

export async function enableOriginAction(
  appId: string,
  originId: string,
  csrf: string,
): Promise<{ error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "origins.enable"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();
  await store.origins.setStatus(originId, "active");

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "origins.enable",
    payload: { originId },
  });

  return {};
}

export async function removeOriginAction(
  appId: string,
  originId: string,
  csrf: string,
): Promise<{ error?: string }> {
  const { githubUserId } = await assertOwner(appId);

  if (!(await checkCsrf(csrf, "origins.remove"))) {
    return { error: "Invalid CSRF token. Refresh and try again." };
  }

  const store = await getFullStore();
  const origins = await store.origins.listForApp(appId);
  if (origins.length <= 1) {
    return {
      error:
        "Cannot remove the last origin. Disable it instead, or revoke the app.",
    };
  }
  await store.origins.remove(originId);

  await writeAudit({
    appId,
    actorGhId: githubUserId,
    eventType: "origins.remove",
    payload: { originId },
  });

  return {};
}
