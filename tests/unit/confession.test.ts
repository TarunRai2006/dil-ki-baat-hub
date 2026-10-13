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

describe("confessionSchema (client mirror of submit_confession)", () => {
  it("accepts a fully filled, valid form", () => {
    expect(confessionSchema.safeParse(validConfession).success).toBe(true);
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
    ["unknown category", { category: "Hacking" }],
    ["five categories", { category: "Career, Family, Anxiety, Other, Confusion" }],
    ["bad intent", { intent: "Admin" }],
    ["mood 0", { emotional_state: 0 }],
    ["mood 6", { emotional_state: 6 }],
    ["fractional mood", { emotional_state: 2.5 }],
    ["bad highlight", { highlight_on_instagram: "Sure" }],
    ["bad ttl", { chat_ttl: "forever" }],
    ["long nickname", { nickname: "n".repeat(41) }],
    ["long question", { community_question: "q".repeat(201) }],
    ["number instead of text", { content: 12345678901 }],
    ["object instead of text", { content: { evil: true } }],
    ["null content", { content: null }],
  ])("rejects %s", (_, patch) => {
    expect(confessionSchema.safeParse({ ...validConfession, ...patch }).success).toBe(false);
  });

  it("accepts up to four categories from the list (older multi-select forms)", () => {
    expect(
      confessionSchema.safeParse({ ...validConfession, category: "Career, Family, Anxiety, Other" })
        .success,
    ).toBe(true);
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
});

describe("submitConfession", () => {
  beforeEach(() => rpc.mockReset());

  it("sends every field and declared age group with the request id, and stores the room", async () => {
    respond([
      {
        submission_id: "s1",
        alias: "Gumnam Dost #7",
        room_id: "r1",
        room_token: "t".repeat(48),
        room_expires_at: null,
      },
    ]);
    const result = await submitConfession(validConfession, "req-1", "18+");
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("submit_confession_v2");
    expect(args).toMatchObject({
      _content: validConfession.content,
      _category: "Career",
      _intent: "Advice",
      _emotional_state: 2,
      _community_question: "Should I talk to my manager?",
      _highlight_on_instagram: "Yes",
      _nickname: "Tired Owl",
      _chat_enabled: true,
      _chat_ttl: "24h",
      _client_request_id: "req-1",
      _age_group: "18+",
    });
    expect(typeof args._anon_user_id).toBe("string");
    expect(result.room?.roomId).toBe("r1");
    expect(latestLiveRoom()?.token).toBe("t".repeat(48));
  });

  it("validates before any network call", async () => {
    await expect(
      submitConfession({ ...validConfession, content: "x" }, "req", "18+"),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the server error (the form turns it into friendly text)", async () => {
    respond(null, { message: "rate_limited" });
    await expect(submitConfession(validConfession, "req-2", "18+")).rejects.toMatchObject({
      message: "rate_limited",
    });
  });

  it("does not create a room when chat was not requested", async () => {
    respond([
      { submission_id: "s2", alias: "A", room_id: null, room_token: null, room_expires_at: null },
    ]);
    const result = await submitConfession(
      { ...validConfession, chat_enabled: false },
      "req-3",
      "18+",
    );
    expect(result.room).toBeNull();
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
