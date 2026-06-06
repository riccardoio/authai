import { refreshTokens, type Tokens } from "./auth-client.js";
import { decryptJson, encryptJson } from "./crypto.js";
import type { AuthRecord, AuthRecordStore } from "./store.js";

export type DecryptedTokens = {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
  originator?: string;
};

const REFRESH_THRESHOLD_MS = 60_000;

export async function loadAndMaybeRefresh(params: {
  store: AuthRecordStore;
  record: AuthRecord;
  recordKey: Buffer;
}): Promise<DecryptedTokens> {
  const tokens = decryptJson<DecryptedTokens>(params.recordKey, {
    iv: params.record.iv,
    blob: params.record.blob,
  });

  if (tokens.expires - Date.now() > REFRESH_THRESHOLD_MS) {
    return tokens;
  }
  if (!tokens.refresh) {
    throw new Error("token expired and no refresh token available");
  }
  const next = await refreshTokens(tokens.refresh);
  const merged: DecryptedTokens = {
    access: next.access,
    refresh: next.refresh,
    expires: next.expires,
    accountId: next.accountId || tokens.accountId,
    originator: tokens.originator,
  };
  const { iv, blob } = encryptJson(params.recordKey, merged);
  await params.store.update(params.record.id, {
    iv,
    blob,
    updatedAt: Date.now(),
  });
  return merged;
}

export function expiryFromRefreshLife(tokens: Tokens): number {
  const days30 = 30 * 24 * 60 * 60 * 1000;
  return tokens.expires + days30;
}
