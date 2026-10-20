import { describe, it, expect, afterEach, vi } from "vitest";
import worker from "../src/index";
// The client-side twin of the Worker's mergePendingEntries (CLAUDE.md
// convention #5). Imported so the parity test below asserts the two hand-kept
// copies agree on every slot type, not merely that each one "does something".
import { mergePending } from "../../js/pending.js";

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

// ---- Pending-entry fixtures (shapes pass validatePendingEntry) ---------------

function logEntry(date = "2026-05-18", reps = 10, day = "monday", type = "push") {
  return {
    type: "log",
    submitted_at: "2026-05-31T12:00:00Z",
    session: {
      date,
      submitted_at: "2026-05-31T12:00:00Z",
      day_of_week: day,
      type,
      routine_id: "2026-W21",
      exercises: [{ exercise_id: "flat-db-bench-press", sets: [{ set: 1, weight_kg: 16, reps }] }],
    },
  };
}

function skipEntry(date = "2026-05-18", day = "monday", type = "push") {
  return {
    type: "skip",
    submitted_at: "2026-05-31T12:00:00Z",
    session: { date, submitted_at: "2026-05-31T12:00:00Z", day_of_week: day, type, routine_id: "2026-W21" },
  };
}

function recoveryEntry(date = "2026-05-18", location = "Embrace North", rounds = 2) {
  return {
    type: "recovery",
    submitted_at: "2026-05-31T12:00:00Z",
    session: {
      date,
      location,
      rounds_detail: Array.from({ length: rounds }, (_, i) => ({ round: i + 1, sauna_min: 15, plunge_min: 3 })),
    },
  };
}

function editEntry(routineId = "2026-W21", day = "monday", exerciseId = "flat-db-bench-press", reps = 12) {
  return {
    type: "routine_edit",
    routine_id: routineId,
    day_of_week: day,
    exercise_id: exerciseId,
    changes: { target_reps: reps },
    created_at: "2026-05-31T12:00:00Z",
  };
}

// ---- GitHub Contents stubs ---------------------------------------------------

const b64 = (s: string) => Buffer.from(s).toString("base64");
const written = (captures: any[]) => JSON.parse(Buffer.from(captures.at(-1).content, "base64").toString("utf8"));

// Stub for the PUT /pat validation round-trip (GET + no-op PUT). Kept separate
// from the append stub so the queue a test seeds is the queue the append
// actually reads. The previous single stub seeded only the FIRST GitHub GET —
// which PAT validation consumed — so the dedupe test ran against an empty
// queue and could not fail even with dedupe deleted outright.
function ghPatStub() {
  return vi.fn(async (url: any, request: any = {}) => {
    if (!String(url).includes("api.github.com")) return new Response("{}", { status: 200 });
    if ((request.method || "GET") === "PUT") return new Response(JSON.stringify({ content: { sha: "patsha" } }), { status: 200 });
    return new Response(JSON.stringify({ content: b64('{"entries":[]}'), sha: "patsha" }), { status: 200 });
  });
}

type AppendStubOpts = {
  entries?: unknown[];     // queue every GET returns (default: empty)
  content?: string;        // raw file text instead of `entries` — for corrupt-file cases
  getStatus?: number;      // non-200 GET status (404 = pending.json does not exist yet)
  firstPutStatus?: number; // fail the first PUT with this status (409 → sha-conflict retry)
};

// Stub for /pending/append: every GET returns the configured file, every PUT
// body is captured.
function ghAppendStub(captures: any[], opts: AppendStubOpts = {}) {
  let putCount = 0;
  return vi.fn(async (url: any, request: any = {}) => {
    if (!String(url).includes("api.github.com")) return new Response("{}", { status: 200 });
    if ((request.method || "GET") === "GET") {
      if (opts.getStatus && opts.getStatus !== 200) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: opts.getStatus });
      }
      const text = opts.content ?? JSON.stringify({ entries: opts.entries ?? [] });
      return new Response(JSON.stringify({ content: b64(text), sha: "cursha" }), { status: 200 });
    }
    putCount += 1;
    captures.push(JSON.parse(request.body));
    if (putCount === 1 && opts.firstPutStatus) return new Response("conflict", { status: opts.firstPutStatus });
    return new Response(JSON.stringify({ content: { sha: "newsha" } }), { status: 200 });
  });
}

async function storePat(env: any) {
  vi.stubGlobal("fetch", ghPatStub());
  const res = await worker.fetch(putPatReq(VALID_PAT), env);
  expect(res.status).toBe(200);
}

// Signed-in env with a vaulted PAT, GitHub stubbed per `opts` for the append.
async function setup(opts: AppendStubOpts = {}) {
  const env = makeEnv();
  await storePat(env);
  const captures: any[] = [];
  vi.stubGlobal("fetch", ghAppendStub(captures, opts));
  return { env, captures };
}

describe("/pending/append", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("appends with server-side dedupe and never returns the PAT", async () => {
    const { env, captures } = await setup({ entries: [logEntry("2026-05-18", 8)] });

    const res = await worker.fetch(req(logEntry("2026-05-18", 12)), env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(body).not.toContain(VALID_PAT);

    const file = written(captures);
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0].session.exercises[0].sets[0].reps).toBe(12);
  });

  it("retries once on a GitHub sha conflict", async () => {
    const { env, captures } = await setup({ firstPutStatus: 409 });

    const res = await worker.fetch(req(logEntry("2026-05-19")), env);
    expect(res.status).toBe(200);
    expect(captures).toHaveLength(2); // failed append PUT + retry PUT
  });

  it("rejects invalid pending entry shapes", async () => {
    const { env, captures } = await setup();

    const res = await worker.fetch(req({ type: "log", session: { date: "2026-05-18" } }), env);
    expect(res.status).toBe(400);
    expect(captures).toHaveLength(0);
  });

  it("requires a valid session", async () => {
    vi.stubGlobal("fetch", ghAppendStub([]));
    const env = makeEnv();
    const res = await worker.fetch(req(logEntry(), null), env);
    expect(res.status).toBe(401);
  });

  describe("slot dedupe (convention #5)", () => {
    it("a new log displaces a pending skip for the same (date, day, type)", async () => {
      const { env, captures } = await setup({ entries: [skipEntry("2026-05-18", "monday", "push")] });
      expect((await worker.fetch(req(logEntry("2026-05-18", 10, "monday", "push")), env)).status).toBe(200);
      expect(written(captures).entries.map((e: any) => e.type)).toEqual(["log"]);
    });

    it("a new skip displaces a pending log for the same slot", async () => {
      const { env, captures } = await setup({ entries: [logEntry("2026-05-18", 10, "monday", "push")] });
      expect((await worker.fetch(req(skipEntry("2026-05-18", "monday", "push")), env)).status).toBe(200);
      expect(written(captures).entries.map((e: any) => e.type)).toEqual(["skip"]);
    });

    it("keeps workout entries for other slots", async () => {
      const { env, captures } = await setup({
        entries: [logEntry("2026-05-18", 8, "monday", "push"), logEntry("2026-05-19", 8, "tuesday", "pull")],
      });
      expect((await worker.fetch(req(logEntry("2026-05-18", 12, "monday", "push")), env)).status).toBe(200);
      const entries = written(captures).entries;
      expect(entries).toHaveLength(2); // tuesday kept, monday replaced
      expect(entries.filter((e: any) => e.session.day_of_week === "monday")).toHaveLength(1);
      expect(entries.find((e: any) => e.session.day_of_week === "monday").session.exercises[0].sets[0].reps).toBe(12);
    });

    it("recovery dedupes by (date, location) and keeps other locations", async () => {
      let { env, captures } = await setup({ entries: [recoveryEntry("2026-05-18", "Embrace North", 2)] });
      expect((await worker.fetch(req(recoveryEntry("2026-05-18", "Embrace North", 3)), env)).status).toBe(200);
      expect(written(captures).entries).toHaveLength(1);
      expect(written(captures).entries[0].session.rounds_detail).toHaveLength(3); // the newer entry won

      ({ env, captures } = await setup({ entries: [recoveryEntry("2026-05-18", "Embrace North")] }));
      expect((await worker.fetch(req(recoveryEntry("2026-05-18", "Other Gym")), env)).status).toBe(200);
      expect(written(captures).entries).toHaveLength(2); // different location kept
    });

    it("routine_edit dedupes by (routine_id, day_of_week, exercise_id) and keeps other exercises", async () => {
      let { env, captures } = await setup({ entries: [editEntry("2026-W21", "monday", "flat-db-bench-press", 10)] });
      expect((await worker.fetch(req(editEntry("2026-W21", "monday", "flat-db-bench-press", 12)), env)).status).toBe(200);
      expect(written(captures).entries).toHaveLength(1);
      expect(written(captures).entries[0].changes.target_reps).toBe(12); // the newer edit won

      ({ env, captures } = await setup({ entries: [editEntry("2026-W21", "monday", "flat-db-bench-press")] }));
      expect((await worker.fetch(req(editEntry("2026-W21", "monday", "incline-db-bench-press")), env)).status).toBe(200);
      expect(written(captures).entries).toHaveLength(2); // different exercise kept
    });

    it("does not cross-dedupe between unrelated entry types", async () => {
      const { env, captures } = await setup({ entries: [recoveryEntry("2026-05-18"), editEntry()] });
      expect((await worker.fetch(req(logEntry("2026-05-18")), env)).status).toBe(200);
      expect(written(captures).entries.map((e: any) => e.type)).toEqual(["recovery", "routine_edit", "log"]);
    });

    // One shared case table run through BOTH implementations. If either copy
    // of the slot rules drifts (a key added on one side, a type guard
    // loosened on the other), this is the test that fails.
    const PARITY_CASES: Array<[string, unknown[], Record<string, unknown>]> = [
      ["log replaces log",               [logEntry("2026-05-18", 8)],                              logEntry("2026-05-18", 12)],
      ["log displaces skip",             [skipEntry("2026-05-18")],                                logEntry("2026-05-18")],
      ["skip displaces log",             [logEntry("2026-05-18")],                                 skipEntry("2026-05-18")],
      ["other workout slots kept",       [logEntry("2026-05-18"), logEntry("2026-05-19", 10, "tuesday", "pull"), logEntry("2026-05-18", 10, "monday", "pull")], logEntry("2026-05-18", 12)],
      ["recovery same (date, location)", [recoveryEntry("2026-05-18", "Embrace North")],           recoveryEntry("2026-05-18", "Embrace North", 3)],
      ["recovery other location kept",   [recoveryEntry("2026-05-18", "Embrace North")],           recoveryEntry("2026-05-18", "Other Gym")],
      ["recovery other date kept",       [recoveryEntry("2026-05-17", "Embrace North")],           recoveryEntry("2026-05-18", "Embrace North")],
      ["routine_edit same key",          [editEntry("2026-W21", "monday", "flat-db-bench-press", 10)], editEntry("2026-W21", "monday", "flat-db-bench-press", 12)],
      ["routine_edit other exercise",    [editEntry("2026-W21", "monday", "flat-db-bench-press")], editEntry("2026-W21", "monday", "incline-db-bench-press")],
      ["routine_edit other day",         [editEntry("2026-W21", "monday")],                         editEntry("2026-W21", "tuesday")],
      ["routine_edit other routine",     [editEntry("2026-W21")],                                   editEntry("2026-W22")],
      ["no cross-type dedupe",           [recoveryEntry("2026-05-18"), editEntry(), skipEntry("2026-05-18")], logEntry("2026-05-18")],
    ];

    it("matches the client's mergePending (js/pending.js) on every slot type", async () => {
      for (const [name, existing, incoming] of PARITY_CASES) {
        const { env, captures } = await setup({ entries: existing });
        const res = await worker.fetch(req(incoming), env);
        expect(res.status, name).toBe(200);
        expect(written(captures).entries, name).toEqual(mergePending(existing, incoming));
      }
    });
  });

  describe("unreadable or missing pending.json", () => {
    const queued = [logEntry("2026-10-19", 10, "monday", "push"), logEntry("2026-10-20", 10, "tuesday", "pull")];

    it("returns 500 and writes nothing when pending.json is unparseable — never treats it as an empty queue", async () => {
      // Two queued workouts plus a stray merge marker from a hand-resolved conflict.
      const corrupt = JSON.stringify({ entries: queued }, null, 2) + "\n<<<<<<< HEAD\n";
      const { env, captures } = await setup({ content: corrupt });

      const res = await worker.fetch(req(logEntry("2026-10-21", 10, "wednesday", "legs")), env);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/unreadable/);
      expect(captures).toHaveLength(0); // no PUT — the queued workouts are untouched
    });

    it("returns 500 and writes nothing when pending.json is not an object with an entries array", async () => {
      for (const content of ["[]", "null", '"text"', '{"entries": {}}', '{"entries": null}', '{"entries": "x"}']) {
        const { env, captures } = await setup({ content });
        const res = await worker.fetch(req(logEntry()), env);
        expect(res.status, content).toBe(500);
        expect((await res.json()).error, content).toMatch(/unreadable/);
        expect(captures, content).toHaveLength(0);
      }
    });

    it("treats an object with no entries key as an empty queue and keeps its other fields", async () => {
      const { env, captures } = await setup({ content: '{"format_note": "hand-made"}' });

      const res = await worker.fetch(req(logEntry("2026-05-18")), env);
      expect(res.status).toBe(200);
      const file = written(captures);
      expect(file.format_note).toBe("hand-made");
      expect(file.entries).toHaveLength(1);
      expect(captures[0].sha).toBe("cursha"); // an update, not a create
    });

    it("starts a fresh queue when pending.json does not exist yet (GitHub 404)", async () => {
      const { env, captures } = await setup({ getStatus: 404 });

      const res = await worker.fetch(req(logEntry("2026-05-18")), env);
      expect(res.status).toBe(200);
      expect(captures).toHaveLength(1);
      expect(written(captures).entries).toEqual([logEntry("2026-05-18")]);
      expect(captures[0]).not.toHaveProperty("sha"); // create, not update — GitHub 422s if the file exists after all
    });

    it("still fails on other GitHub read errors", async () => {
      const { env, captures } = await setup({ getStatus: 500 });
      const res = await worker.fetch(req(logEntry()), env);
      expect(res.status).toBe(502);
      expect(captures).toHaveLength(0);
    });
  });
});
