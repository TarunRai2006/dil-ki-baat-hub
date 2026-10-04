import { beforeEach, describe, expect, it, vi } from "vitest";
import { stats as statsFixture, toRow, tiredOwl } from "../fixtures/data";

/**
 * A chainable stand-in for the supabase query builder that records every call,
 * so tests can prove filtering, sorting and paging happen in the database.
 */
type Call = [string, ...unknown[]];
let calls: Call[] = [];
let result: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };
function builder(): unknown {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_, prop: string) {
      if (prop === "then")
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject);
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return builder();
      };
    },
  });
}
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder();
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const admin = await import("@/lib/admin");
const { DEFAULT_FILTERS, PAGE_SIZE } = admin;
const named = (name: string) => calls.filter((c) => c[0] === name);

beforeEach(() => {
  calls = [];
  result = { data: [toRow(tiredOwl)], error: null, count: 45 };
  rpc.mockReset();
});

describe("fetchSubmissions builds one indexed, paged database query", () => {
  it("default view: active, not trashed, newest first, page 1, counted", async () => {
    const out = await admin.fetchSubmissions(DEFAULT_FILTERS);
    expect(calls[0]).toEqual(["from", "submissions"]);
    const select = named("select")[0];
    expect(select[2]).toEqual({ count: "exact" });
    // list rows never fetch private/detail columns
    expect(String(select[1])).not.toMatch(
      /admin_notes|community_question|anon_user_id|search_text/,
    );
    expect(named("is")).toContainEqual(["is", "deleted_at", null]);
    expect(named("eq")).toContainEqual(["eq", "is_archived", false]);
    expect(named("order")[0]).toEqual(["order", "created_at", { ascending: false }]);
    // deterministic tie-break so pages never overlap or skip
    expect(named("order")[1]).toEqual(["order", "id", { ascending: true }]);
    expect(named("range")[0]).toEqual(["range", 0, PAGE_SIZE - 1]);
    expect(out.total).toBe(45);
  });

  it("combines every filter in the WHERE clause", async () => {
    await admin.fetchSubmissions({
      ...DEFAULT_FILTERS,
      search: "  manager  ",
      status: "Approved",
      category: "Self thoughts",
      intent: "Advice",
      mood: 4,
      featured: true,
      view: "archived",
      from: "2026-10-01",
      to: "2026-10-03",
      sort: "oldest",
      page: 2,
    });
    expect(named("eq")).toEqual(
      expect.arrayContaining([
        ["eq", "is_archived", true],
        ["eq", "status", "Approved"],
        ["eq", "intent", "Advice"],
        ["eq", "emotional_state", 4],
        ["eq", "is_featured", true],
      ]),
    );
    expect(named("ilike")).toEqual(
      expect.arrayContaining([
        ["ilike", "category", "%Self thoughts%"],
        ["ilike", "search_text", "%manager%"],
      ]),
    );
    expect(named("gte")[0][1]).toBe("created_at");
    expect(named("lt")[0][1]).toBe("created_at");
    // "to" is inclusive of the whole day
    const from = new Date(String(named("gte")[0][2]));
    const to = new Date(String(named("lt")[0][2]));
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(3);
    expect(named("order")[0]).toEqual(["order", "created_at", { ascending: true }]);
    expect(named("range")[0]).toEqual(["range", 40, 59]);
  });

  it("escapes LIKE wildcards typed into search", async () => {
    await admin.fetchSubmissions({ ...DEFAULT_FILTERS, search: "100%_sure\\" });
    expect(named("ilike")[0]).toEqual(["ilike", "search_text", "%100\\%\\_sure\\\\%"]);
  });

  it("trash view shows only soft-deleted rows; recently-updated sort", async () => {
    await admin.fetchSubmissions({ ...DEFAULT_FILTERS, view: "trash", sort: "updated" });
    expect(named("not")).toContainEqual(["not", "deleted_at", "is", null]);
    expect(named("eq").some((c) => c[1] === "is_archived")).toBe(false);
    expect(named("order")[0]).toEqual(["order", "updated_at", { ascending: false }]);
  });

  it("throws database errors to the caller (the UI shows a retry state)", async () => {
    result = { data: null, error: { message: "permission denied" } };
    await expect(admin.fetchSubmissions(DEFAULT_FILTERS)).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});

describe("fetchSubmission (detail) asks for the private columns", () => {
  it("selects notes and review metadata for one id", async () => {
    result = { data: tiredOwl, error: null };
    await admin.fetchSubmission(tiredOwl.id);
    expect(String(named("select")[0][1])).toMatch(/admin_notes/);
    expect(named("eq")).toContainEqual(["eq", "id", tiredOwl.id]);
    expect(named("single")).toHaveLength(1);
  });
});

describe("updateSubmission sends only what changed, through the guarded function", () => {
  it.each([
    [{ status: "Approved" as const }, { _status: "Approved" }],
    [{ is_featured: true }, { _is_featured: true }],
    [{ is_archived: false }, { _is_archived: false }],
    [{ admin_notes: "" }, { _admin_notes: "" }],
    [{ deleted: true }, { _deleted: true }],
  ])("%j", async (patch, expected) => {
    rpc.mockResolvedValueOnce({ data: tiredOwl, error: null });
    await admin.updateSubmission(tiredOwl.id, patch);
    expect(rpc).toHaveBeenCalledWith("admin_update_submission", { _id: tiredOwl.id, ...expected });
  });

  it("rejects when the database refuses (the UI rolls back)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    await expect(admin.updateSubmission(tiredOwl.id, { status: "Rejected" })).rejects.toMatchObject(
      {
        message: "not_authorized",
      },
    );
  });
});

describe("fetchStats normalises the aggregate", () => {
  it("passes real numbers through and defaults missing ones to zero", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...statsFixture, pulse: "2.50", rejected: undefined },
      error: null,
    });
    const s = await admin.fetchStats();
    expect(s.total).toBe(45);
    expect(s.pulse).toBe(2.5);
    expect(s.rejected).toBe(0);
    expect(s.moods).toHaveLength(5);
  });
});

describe("human labels", () => {
  it("describePatch", () => {
    expect(admin.describePatch({ status: "Approved" })).toBe("Marked approved");
    expect(admin.describePatch({ is_archived: true })).toBe("Archived");
    expect(admin.describePatch({ is_archived: false })).toBe("Restored");
    expect(admin.describePatch({ is_featured: false })).toBe("Unfeatured");
    expect(admin.describePatch({ admin_notes: "x" })).toBe("Notes saved");
  });

  it("describeLog reads per-field audit entries", () => {
    const e = (action: string, detail = {}) =>
      admin.describeLog({ id: 1, created_at: "", action: action as never, detail });
    expect(e("STATUS_CHANGED", { old: "Pending", new: "Approved" })).toBe(
      "Status Pending → Approved",
    );
    expect(e("ARCHIVED")).toBe("Archived");
    expect(e("UNTRASHED")).toBe("Restored from trash");
    expect(e("NOTE_UPDATED")).toBe("Notes edited");
  });
});

describe("fetchRooms", () => {
  it("live rooms: open and not past their expiry, with message counts", async () => {
    result = { data: [], error: null };
    await admin.fetchRooms("live");
    expect(calls[0]).toEqual(["from", "chat_rooms"]);
    expect(String(named("select")[0][1])).toMatch(/chat_messages\(count\)/);
    expect(named("eq")).toContainEqual(["eq", "status", "open"]);
    expect(String(named("or")[0][1])).toMatch(/^expires_at\.is\.null,expires_at\.gt\./);
  });
});

describe("fetchRooms latest message", () => {
  it("embeds only the newest message per room, in the same request", async () => {
    result = { data: [], error: null };
    await admin.fetchRooms("ended");
    expect(String(named("select")[0][1])).toMatch(/last:chat_messages\(/);
    expect(named("order")).toContainEqual([
      "order",
      "created_at",
      { referencedTable: "last", ascending: false },
    ]);
    expect(named("limit")).toContainEqual(["limit", 1, { referencedTable: "last" }]);
  });
});

describe("unread rooms", () => {
  const room = (sender: string, at: string) =>
    ({
      id: "r1",
      status: "open",
      created_at: at,
      expires_at: null,
      last_message_at: at,
      submissions: null,
      chat_messages: [{ count: 1 }],
      last: [{ message: "hi", sender_type: sender, created_at: at }],
    }) as const;

  it("unread when the visitor spoke after the mentor last looked", () => {
    expect(
      admin.isUnread(
        {
          ...room("user", "2026-10-04T10:00:00Z"),
          last: [...room("user", "2026-10-04T10:00:00Z").last],
        },
        {},
      ),
    ).toBe(true);
    const r = {
      ...room("user", "2026-10-04T10:00:00Z"),
      last: [...room("user", "2026-10-04T10:00:00Z").last],
    };
    expect(admin.isUnread(r, { r1: "2026-10-04T10:00:00Z" })).toBe(false);
    expect(admin.isUnread(r, { r1: "2026-10-04T09:00:00Z" })).toBe(true);
  });

  it("the mentor's own last reply, or an empty room, is never unread", () => {
    const mine = {
      ...room("admin", "2026-10-04T10:00:00Z"),
      last: [...room("admin", "2026-10-04T10:00:00Z").last],
    };
    expect(admin.isUnread(mine, {})).toBe(false);
    expect(admin.isUnread({ ...mine, last: [] }, {})).toBe(false);
  });

  it("seen markers survive a reload and tolerate corrupt storage", () => {
    admin.saveSeen({ r1: "2026-10-04T10:00:00Z" });
    expect(admin.loadSeen()).toEqual({ r1: "2026-10-04T10:00:00Z" });
    localStorage.setItem("dkb_admin_seen", "{not json");
    expect(admin.loadSeen()).toEqual({});
  });
});
