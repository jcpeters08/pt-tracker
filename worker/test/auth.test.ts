import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";

// Minimal in-memory KVNamespace stand-in (TTLs are ignored — fine for these tests).
function makeKV() {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    _store: store,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    KV: makeKV(),
    ALLOWED_ORIGIN: "https://example.com",
    APP_URL: "https://example.com",
    ALLOWED_EMAILS: "user@example.com",
    RESEND_API_KEY: "test-key",
    PAT_ENC_KEY: Buffer.from(new Uint8Array(32)).toString("base64"),
    ...overrides,
  } as any;
}

function authReq(email: string, ip = "1.2.3.4") {
  return new Request("https://w/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ email }),
  });
}

const resendCalls = () =>
  (fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes("resend.com")).length;

describe("/auth/request rate limiting", () => {
  beforeEach(() => {
    // Stub the Resend email send so under-limit requests don't hit the network.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends up to the per-email limit (3), then throttles — still {ok:true}, no email", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(authReq("user@example.com"), env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true }); // no enumeration signal, even throttled
    }
    expect(resendCalls()).toBe(3); // 1st–3rd send; 4th & 5th throttled
  });

  it("throttles by IP (10) across multiple allowlisted emails from one IP", async () => {
    const env = makeEnv({ ALLOWED_EMAILS: "a@example.com,b@example.com,c@example.com,d@example.com" });
    const emails = ["a", "b", "c", "d"];
    for (const e of emails) {
      for (let i = 0; i < 3; i++) {
        await worker.fetch(authReq(`${e}@example.com`, "9.9.9.9"), env);
      }
    }
    // a,b,c send 3 each (9); d sends 1 (10th) then the IP window blocks the rest.
    expect(resendCalls()).toBe(10);
  });

  it("non-allowlisted email returns {ok:true} and sends nothing", async () => {
    const env = makeEnv();
    const res = await worker.fetch(authReq("nope@example.com"), env);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendCalls()).toBe(0);
  });

  it("email limit is enforced even when the caller switches IP", async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) await worker.fetch(authReq("user@example.com", "1.1.1.1"), env);
    // same email from a new IP is still email-limited (email key is shared)
    const res = await worker.fetch(authReq("user@example.com", "2.2.2.2"), env);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendCalls()).toBe(3); // email limit (3) already hit, IP change doesn't bypass it
  });
});
