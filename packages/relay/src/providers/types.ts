export type ProviderId = "openai" | "xai" | "github";

export type DeviceCodeStart = {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
  expiresInMs: number;
};

export type ProviderTokens = {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
};

export type PollResult =
  | { status: "pending" }
  | { status: "ready"; tokens: ProviderTokens };

export type ProxyParams = {
  tokens: ProviderTokens;
  body: unknown;
  wantsStream: boolean;
};

export type ProxyResult = {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text?: string;
  contentType?: string;
};

export type ProviderModel = {
  id: string;
  ownedBy?: string;
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Provider OAuth start. `originator` is the operator-configured app name. */
  requestDeviceCode(originator: string): Promise<DeviceCodeStart>;

  /** Poll device-code state. `originator` carries through from sign-in. */
  pollDeviceCode(state: PendingState, originator: string): Promise<PollResult>;

  /**
   * Refresh provider tokens. `originator` comes from the stored record so a
   * relay can rotate without losing the brand the user originally consented
   * to. Provider adapters that don't consume `originator` can ignore it.
   */
  refreshTokens(refreshToken: string, originator: string): Promise<ProviderTokens>;

  listModels(tokens: ProviderTokens): Promise<ProviderModel[]>;
  proxyChatCompletions(params: ProxyParams): Promise<ProxyResult>;
  proxyResponses?(params: ProxyParams): Promise<ProxyResult>;
}

export type PendingState = {
  deviceAuthId: string;
  userCode: string;
  providerExtra?: Record<string, unknown>;
};
