import { beforeEach, describe, expect, it, vi } from "vitest";
import { validConfession } from "../fixtures/data";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const {
  confessionSchema,
  chatMessageSchema,
  errorCode,
  friendlyError,
  submitConfession,
  saveRoom,
  forgetRoom,
  latestLiveRoom,
  fetchWhispers,
} = await import("@/lib/confession");

/** supabase.rpc(...).abortSignal(...) resolves to { data, error } */
const respond = (data: unknown, error: unknown = null) =>
  rpc.mockReturnValueOnce({ abortSignal: () => Promise.resolve({ data, error }) });

describe("confessionSchema (written intake)", () => {
  it("accepts a valid written story", () => {
    expect(confessionSchema.safeParse({ content: validConfession.content }).success).toBe(true);
  });

  it("trims surrounding whitespace but keeps line breaks inside", () => {
    const r = confessionSchema.parse({ ...validConfession, content: "  line one\nline two   \n" });
    expect(r.content).toBe("line one\nline two");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "      \n\t  "],
    ["too short", "short"],
    ["too long", "x".repeat(2001)],
  ])("rejects %s content", (_, content) => {
    expect(confessionSchema.safeParse({ ...validConfession, content }).success).toBe(false);
  });

  it("explains short content in human words", () => {
    const r = confessionSchema.safeParse({ ...validConfession, content: "hi" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/one honest sentence/i);
  });

  it("drops NUL and other control characters (Postgres cannot store NUL)", () => {
    const r = confessionSchema.parse({
      ...validConfession,
      content: "a\u0000b\u0007c and enough words",
    });
    expect(r.content).toBe("abc and enough words");
  });

  it("keeps HTML, SQL-looking text, emoji and Hindi as plain text", () => {
    const content = "<script>alert(1)</script> '; DROP TABLE x; -- 🙂 दिल की बात";
    expect(confessionSchema.parse({ ...validConfession, content }).content).toBe(content);
  });

  it.each([
    ["number instead of text", { content: 12345678901 }],
    ["object instead of text", { content: { evil: true } }],
    ["null content", { content: null }],
  ])("rejects %s", (_, patch) => {
    expect(confessionSchema.safeParse({ ...validConfession, ...patch }).success).toBe(false);
  });

  it("keeps restored private choices and drops the former public-sharing input", () => {
    expect(confessionSchema.parse(validConfession)).toEqual({
      content: validConfession.content,
      category: "Career",
      intent: "Advice",
      emotional_state: 2,
      community_question: "Should I talk to my manager?",
      nickname: "Tired Owl",
      chat_ttl: "24h",
    });
    expect(confessionSchema.parse({ content: validConfession.content })).toEqual({
      content: validConfession.content,
    });
  });

  it("rejects invalid check-in answers", () => {
    expect(
      confessionSchema.safeParse({ content: validConfession.content, intent: "Publish" }).success,
    ).toBe(false);
    expect(
      confessionSchema.safeParse({ content: validConfession.content, emotional_state: 6 }).success,
    ).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("trims and accepts a normal message", () => {
    expect(chatMessageSchema.parse("  hello  ")).toBe("hello");
  });
  it.each([
    ["empty", ""],
    ["whitespace", " \n "],
    ["1001 chars", "x".repeat(1001)],
  ])("rejects %s", (_, m) => expect(chatMessageSchema.safeParse(m).success).toBe(false));
});

describe("friendlyError: never show raw database errors", () => {
  it.each([
    ["rate_limited", /take a breath/i],
    ["room_expired", /disappeared as promised/i],
    ["not_authorized", /permission/i],
    ["invalid_content", /between 10 and 2000/i],
  ])("maps %s", (message, expected) => {
    expect(friendlyError({ message })).toMatch(expected);
  });

  it("hides PostgrestError details behind the fallback", () => {
    const raw = {
      message: "PostgrestError: duplicate key value violates unique constraint",
      code: "23505",
    };
    expect(friendlyError(raw, "Something went wrong.")).toBe("Something went wrong.");
  });

  it("recognises network failures and timeouts", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/could not reach/i);
    expect(errorCode(new DOMException("aborted", "AbortError"))).toBe("timeout");
  });

  it("treats Postgres 42501 as not authorised", () => {
    expect(errorCode({ message: "permission denied for table submissions", code: "42501" })).toBe(
      "not_authorized",
    );
  });

  it("explains when the submission function has not been deployed", () => {
    const error = { code: "PGRST202", message: "Could not find the function" };
    expect(errorCode(error)).toBe("missing_submission_function");
    expect(friendlyError(error)).toMatch(/submissions are temporarily unavailable/i);
    expect(friendlyError(error)).not.toContain("Could not find the function");
  });
});

describe("submitConfession", () => {
  beforeEach(() => rpc.mockReset());

  it("sends a private submission with confirmation and stores the room", async () => {
    respond([
      {
        submission_id: "s1",
        alias: "Gumnam Dost #7",
        room_id: "r1",
        room_token: "t".repeat(48),
        room_expires_at: null,
      },
    ]);
    const result = await submitConfession(validConfession, "req-1");
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("submit_confession_v6");
    expect(args).toMatchObject({
      _content: validConfession.content,
      _client_request_id: "req-1",
      _consent_confirmed: true,
      _intent: "Advice",
      _emotional_state: 2,
      _category: "Career",
      _community_question: "Should I talk to my manager?",
      _nickname: "Tired Owl",
      _chat_ttl: "24h",
    });
    expect(Object.keys(args).sort()).toEqual([
      "_anon_user_id",
      "_category",
      "_chat_ttl",
      "_client_request_id",
      "_community_question",
      "_consent_confirmed",
      "_content",
      "_emotional_state",
      "_intent",
      "_nickname",
    ]);
    expect(typeof args._anon_user_id).toBe("string");
    expect(result.room?.roomId).toBe("r1");
    expect(latestLiveRoom()?.token).toBe("t".repeat(48));
  });

  it("validates before any network call", async () => {
    await expect(submitConfession({ ...validConfession, content: "x" }, "req")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends null for unanswered optional choices", async () => {
    respond([
      {
        submission_id: "s3",
        alias: "A",
        room_id: "r3",
        room_token: "u".repeat(48),
        room_expires_at: null,
      },
    ]);
    await submitConfession({ content: validConfession.content }, "req-optional");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      _category: null,
      _intent: null,
      _emotional_state: null,
      _community_question: "",
      _nickname: "",
      _chat_ttl: "never",
    });
  });

  it("surfaces the server error (the form turns it into friendly text)", async () => {
    respond(null, { message: "rate_limited" });
    await expect(submitConfession(validConfession, "req-2")).rejects.toMatchObject({
      message: "rate_limited",
    });
  });

  it("rejects a server response without the required chat room", async () => {
    respond([
      { submission_id: "s2", alias: "A", room_id: null, room_token: null, room_expires_at: null },
    ]);
    await expect(submitConfession({ content: validConfession.content }, "req-3")).rejects.toThrow(
      "invalid_request",
    );
    expect(latestLiveRoom()).toBeNull();
  });
});

describe("room storage (the chat capability lives only in this browser)", () => {
  const base = { token: "t".repeat(48), alias: "A" };

  it("returns the most recent room that has not expired", () => {
    saveRoom({ ...base, roomId: "old", expiresAt: new Date(Date.now() - 1000).toISOString() });
    saveRoom({ ...base, roomId: "live", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(latestLiveRoom()?.roomId).toBe("live");
  });

  it("never-expiring rooms stay available; forgetRoom removes one", () => {
    saveRoom({ ...base, roomId: "forever", expiresAt: null });
    expect(latestLiveRoom()?.roomId).toBe("forever");
    forgetRoom("forever");
    expect(latestLiveRoom()).toBeNull();
  });

  it("survives corrupt storage", () => {
    window.localStorage.setItem("dkb_chat_rooms", "{not json");
    expect(latestLiveRoom()).toBeNull();
    window.localStorage.setItem("dkb_chat_rooms", JSON.stringify([{ nope: 1 }]));
    expect(latestLiveRoom()).toBeNull();
  });
});

describe("fetchWhispers", () => {
  beforeEach(() => rpc.mockReset());
  it("returns excerpts only", async () => {
    respond([{ excerpt: "one" }, { excerpt: "two" }]);
    expect(await fetchWhispers()).toEqual(["one", "two"]);
  });
  it("shows nothing (never fake lines) when the call fails", async () => {
    respond(null, { message: "boom" });
    expect(await fetchWhispers()).toEqual([]);
  });
});
