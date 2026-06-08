import { describe, it, expect } from "vitest";
import { renderSupabaseEdgeTemplate } from "./supabase.js";

describe("Supabase edge template", () => {
  const template = renderSupabaseEdgeTemplate({
    appName: "My App",
    secretEnvVar: "AUTH_AI_SECRET",
    relayUrl: "https://relay.authai.io",
    allowedOrigin: "https://my-app.example.com",
  });

  it("starts with the SECURITY comment block", () => {
    expect(template.split("\n")[0]).toMatch(/^\/\/ SECURITY:/);
  });

  it("CORS Access-Control-Allow-Origin is the configured origin, not '*'", () => {
    expect(template).toContain('"Access-Control-Allow-Origin": "https://my-app.example.com"');
    expect(template).not.toContain('"Access-Control-Allow-Origin": "*"');
  });

  it("includes a 1MB body size cap", () => {
    expect(template).toContain("MAX_BODY_BYTES");
    expect(template).toContain("1 * 1024 * 1024");
  });

  it("requires Authorization header (401 without)", () => {
    expect(template).toContain('req.headers.get("authorization")');
    expect(template).toContain("status: 401");
  });

  it("does NOT log the secret or the bearer token", () => {
    const lines = template.split("\n");
    for (const line of lines) {
      if (line.includes("console.log") || line.includes("console.error")) {
        expect(line).not.toContain("authorization");
        expect(line).not.toContain("Bearer");
        expect(line).not.toContain("AUTH_AI_SECRET");
        expect(line).not.toContain("Deno.env.get");
      }
    }
  });

  it("passes the secret via x-authai-secret header to the relay", () => {
    expect(template).toContain('"x-authai-secret": secret');
    expect(template).toContain('Deno.env.get("AUTH_AI_SECRET")');
  });

  it("includes deploy + env-set instructions in the comment block", () => {
    expect(template).toContain("supabase functions deploy chat");
    expect(template).toContain("supabase secrets set AUTH_AI_SECRET");
  });
});
