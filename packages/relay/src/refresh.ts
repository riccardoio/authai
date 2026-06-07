import { decryptJson, encryptJson } from "./crypto.js";
import { getProvider } from "./providers/registry.js";
import type { ProviderId } from "./providers/types.js";
import type { AuthRecord, AuthRecordStore } from "./store.js";

export type DecryptedRecord = {
  provider: ProviderId;
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
  originator?: string;
};

const REFRESH_THRESHOLD_MS = 60_000;
const MAX_RETRIES = 1;

/**
 * Decrypt a record, refreshing the provider's OAuth tokens if the cached
 * access token is at or near expiry. On refresh, the new tokens are
 * re-encrypted under the same per-record key K and persisted via a CAS
 * update keyed on the row's previous `updated_at`.
 *
 * If the CAS fails (another concurrent request already refreshed the same
 * record), we re-read the row, decrypt the now-fresher tokens, and use
 * those — avoiding both a duplicate provider refresh call and the
 * lost-update window where the slower writer would clobber a newer rotation.
 */
export async function loadAndMaybeRefresh(params: {
  store: AuthRecordStore;
  record: AuthRecord;
  recordKey: Buffer;
  expectedProvider: ProviderId;
}): Promise<DecryptedRecord> {
  return refreshInternal({ ...params, attempt: 0 });
}

async function refreshInternal(params: {
  store: AuthRecordStore;
  record: AuthRecord;
  recordKey: Buffer;
  expectedProvider: ProviderId;
  attempt: number;
}): Promise<DecryptedRecord> {
  const decrypted = decryptJson<DecryptedRecord>(params.recordKey, {
    iv: params.record.iv,
    blob: params.record.blob,
  });

  if (decrypted.provider !== params.expectedProvider) {
    throw new Error("JWT provider does not match stored record provider");
  }

  if (decrypted.expires - Date.now() > REFRESH_THRESHOLD_MS) return decrypted;
  if (!decrypted.refresh) throw new Error("token expired and no refresh token available");

  const adapter = getProvider(decrypted.provider);
  // The originator is whatever the user originally consented to. Preserve
  // it across token refresh so the upstream provider sees the same brand
  // instead of "authai-relay" on subsequent rotations.
  const next = await adapter.refreshTokens(
    decrypted.refresh,
    decrypted.originator ?? "authai-relay",
  );
  const merged: DecryptedRecord = {
    provider: decrypted.provider,
    access: next.access,
    refresh: next.refresh,
    expires: next.expires,
    accountId: next.accountId || decrypted.accountId,
    originator: decrypted.originator,
  };
  const { iv, blob } = encryptJson(params.recordKey, merged);
  const wrote = await params.store.update(
    params.record.id,
    { iv, blob, updatedAt: Date.now() },
    params.record.updatedAt,
  );
  if (wrote) return merged;

  // CAS lost — another writer refreshed the same record in between. Re-read
  // the row and try once more with the newer ciphertext; if that one is also
  // fresh we'll return it directly without doing a second provider refresh.
  if (params.attempt >= MAX_RETRIES) {
    throw new Error("concurrent refresh conflict");
  }
  const fresh = await params.store.get(params.record.id);
  if (!fresh) throw new Error("record disappeared during refresh");
  return refreshInternal({
    store: params.store,
    record: fresh,
    recordKey: params.recordKey,
    expectedProvider: params.expectedProvider,
    attempt: params.attempt + 1,
  });
}
