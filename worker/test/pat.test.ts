import { describe, it, expect, afterEach, vi } from "vitest";
import worker from "../src/index";

const SID = "test-session-id";
const VALID_PAT = "github_pat_11ABCDE0_abcdefABCDEF0123456789";

function makeKV(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    _store: store,
  };
}

function makeEnv() {
  return {
    KV: makeKV({ [`session:${SID}`]: JSON.stringify({ email: "user@example.com" }) }),
    ALLOWED_ORIGIN: "https://example.com",
    APP_URL: "https://example.com",
    ALLOWED_EMAILS: "user@example.com",
    RESEND_API_KEY: "test-key",
    PAT_ENC_KEY: Buffer.from(new Uint8Array(32)).toString("base64"),
    GITHUB_REPO_OWNER: "owner",
    GITHUB_REPO_NAME: "repo",
  } as any;
}

// GitHub stub: GET returns file {content, sha}; PUT is the no-op write check.
function ghStub({ getStatus = 200, putStatus = 200 } = {}) {
  return vi.fn(async (url: any, opts: any = {}) => {
    if (String(url).includes("api.github.com")) {
      if ((opts.method || "GET") === "PUT") return new Response(JSON.stringify({}), { status: putStatus });
      return new Response(JSON.stringify({ content: "e30=\n", sha: "abc123" }), { status: getStatus });
    }
    return new Response("{}", { status: 200 });
  });
}

function putPatReq(pat: string, sid: string | null = SID) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sid) headers.Authorization = `Bearer ${sid}`;
  return new Request("https://w/pat", { method: "PUT", headers, body: JSON.stringify({ pat }) });
}

describe("/pat PUT — server-side validation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stores the encrypted PAT when the token can read and write", async () => {
    vi.stubGlobal("fetch", ghStub({ getStatus: 200, putStatus: 200 }));
    const env = makeEnv();
    const res = await worker.fetch(putPatReq(VALID_PAT), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const stored = await env.KV.get("pat:user@example.com");
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(VALID_PAT); // stored encrypted, not plaintext
  });

  it("rejects a malformed token before making any GitHub call", async () => {
    const fetchMock = ghStub();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const res = await worker.fetch(putPatReq("not-a-real-token"), env);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await env.KV.get("pat:user@example.com")).toBeNull();
  });

  it("rejects when the token cannot read the repo (GitHub 404)", async () => {
    vi.stubGlobal("fetch", ghStub({ getStatus: 404 }));
    const env = makeEnv();
    const res = await worker.fetch(putPatReq(VALID_PAT), env);
    expect(res.status).toBe(400);
    expect(await env.KV.get("pat:user@example.com")).toBeNull();
  });

  it("rejects a read-only token (write check returns 403)", async () => {
    vi.stubGlobal("fetch", ghStub({ getStatus: 200, putStatus: 403 }));
    const env = makeEnv();
    const res = await worker.fetch(putPatReq(VALID_PAT), env);
    expect(res.status).toBe(400);
    expect(await env.KV.get("pat:user@example.com")).toBeNull();
  });

  it("requires a valid session", async () => {
    vi.stubGlobal("fetch", ghStub());
    const env = makeEnv();
    const res = await worker.fetch(putPatReq(VALID_PAT, null), env);
    expect(res.status).toBe(401);
  });
});
