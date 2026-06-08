"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFullStore } from "@/lib/db";
import { classifyOriginTier, normalizeOrigin } from "@authai/cloud";

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

export async function addOriginAction(
  appId: string,
  originRaw: string,
): Promise<{ error?: string }> {
  await assertOwner(appId);
  // TODO(phase7): await verifyCsrf("origins.add");
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
  return {};
}

export async function disableOriginAction(
  appId: string,
  originId: string,
): Promise<{ error?: string }> {
  await assertOwner(appId);
  // TODO(phase7): await verifyCsrf("origins.disable");
  const store = await getFullStore();
  await store.origins.setStatus(originId, "disabled");
  return {};
}

export async function enableOriginAction(
  appId: string,
  originId: string,
): Promise<{ error?: string }> {
  await assertOwner(appId);
  // TODO(phase7): await verifyCsrf("origins.enable");
  const store = await getFullStore();
  await store.origins.setStatus(originId, "active");
  return {};
}

export async function removeOriginAction(
  appId: string,
  originId: string,
): Promise<{ error?: string }> {
  await assertOwner(appId);
  // TODO(phase7): await verifyCsrf("origins.remove");
  const store = await getFullStore();
  const origins = await store.origins.listForApp(appId);
  if (origins.length <= 1) {
    return {
      error:
        "Cannot remove the last origin. Disable it instead, or revoke the app.",
    };
  }
  await store.origins.remove(originId);
  return {};
}
