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

function req(entry: unknown, sid: string | null = SID) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sid) headers.Authorization = `Bearer ${sid}`;
  return new Request("https://w/pending/append", { method: "POST", headers, body: JSON.stringify({ entry }) });
}

function putPatReq(pat: string) {
  return new Request("https://w/pat", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SID}` },
    body: JSON.stringify({ pat }),
  });
}

function logEntry(date = "2026-05-18", reps = 10) {
  return {
    type: "log",
    submitted_at: "2026-05-31T12:00:00Z",
    session: {
      date,
      submitted_at: "2026-05-31T12:00:00Z",
      day_of_week: "monday",
      type: "push",
      routine_id: "2026-W21",
      exercises: [{ exercise_id: "flat-db-bench-press", sets: [{ set: 1, weight_kg: 16, reps }] }],
    },
  };
}

function ghAppendStub(captures: any[], opts: { firstPutStatus?: number } = {}) {
  let getCount = 0;
  let putCount = 0;
  return vi.fn(async (url: any, request: any = {}) => {
    if (!String(url).includes("api.github.com")) return new Response("{}", { status: 200 });
    const method = request.method || "GET";
    if (method === "GET") {
      getCount += 1;
      const json = getCount === 1
        ? { entries: [logEntry("2026-05-18", 8)] }
        : { entries: [] };
      return new Response(JSON.stringify({
        content: Buffer.from(JSON.stringify(json)).toString("base64"),
        sha: `sha${getCount}`,
      }), { status: 200 });
    }
    putCount += 1;
    captures.push(JSON.parse(request.body));
    if (putCount === 2 && opts.firstPutStatus) return new Response("conflict", { status: opts.firstPutStatus });
    return new Response(JSON.stringify({ content: { sha: "newsha" } }), { status: 200 });
  });
}

async function storePat(env: any, fetchMock: any) {
  vi.stubGlobal("fetch", fetchMock);
  const res = await worker.fetch(putPatReq(VALID_PAT), env);
  expect(res.status).toBe(200);
}

describe("/pending/append", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("appends with server-side dedupe and never returns the PAT", async () => {
    const captures: any[] = [];
    const fetchMock = ghAppendStub(captures);
    const env = makeEnv();
    await storePat(env, fetchMock);

    const res = await worker.fetch(req(logEntry("2026-05-18", 12)), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const written = JSON.parse(Buffer.from(captures.at(-1).content, "base64").toString("utf8"));
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].session.exercises[0].sets[0].reps).toBe(12);
  });

  it("retries once on a GitHub sha conflict", async () => {
    const captures: any[] = [];
    const fetchMock = ghAppendStub(captures, { firstPutStatus: 409 });
    const env = makeEnv();
    await storePat(env, fetchMock);

    const res = await worker.fetch(req(logEntry("2026-05-19")), env);
    expect(res.status).toBe(200);
    expect(captures).toHaveLength(3); // PAT validation PUT + failed append PUT + retry PUT
  });

  it("rejects invalid pending entry shapes", async () => {
    const captures: any[] = [];
    const fetchMock = ghAppendStub(captures);
    const env = makeEnv();
    await storePat(env, fetchMock);

    const res = await worker.fetch(req({ type: "log", session: { date: "2026-05-18" } }), env);
    expect(res.status).toBe(400);
  });

  it("requires a valid session", async () => {
    vi.stubGlobal("fetch", ghAppendStub([]));
    const env = makeEnv();
    const res = await worker.fetch(req(logEntry(), null), env);
    expect(res.status).toBe(401);
  });
});
