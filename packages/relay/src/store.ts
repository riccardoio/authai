export type AuthRecord = {
  id: string;
  iv: Uint8Array;
  blob: Uint8Array;
  accountIdHash: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export interface AuthRecordStore {
  put(record: AuthRecord): Promise<void>;
  get(id: string): Promise<AuthRecord | null>;
  findByAccountHash(hash: string): Promise<AuthRecord | null>;
  update(id: string, patch: Partial<Pick<AuthRecord, "blob" | "iv" | "updatedAt" | "expiresAt">>): Promise<void>;
  delete(id: string): Promise<void>;
  sweepExpired(now: number): Promise<number>;
  close(): Promise<void>;
}
