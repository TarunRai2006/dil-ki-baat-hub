import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { messages as fixtureMessages, room } from "../fixtures/data";

/** Fake Supabase: token-checked RPCs answered from an in-memory room, plus a realtime channel. */
type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
const server = {
  status: "open" as "open" | "closed" | "expired",
  messages: [] as typeof fixtureMessages,
  failNextOpen: false,
  failNextSend: false,
  rpcCalls: [] as string[],
};
const handlers = new Map<string, (p: { payload: Record<string, unknown> }) => void>();
let subscribeCb: ((s: Status) => void) | null = null;
const removeChannel = vi.fn();

function answer(fn: string, args: Record<string, unknown>) {
  server.rpcCalls.push(fn);
  if (fn === "get_chat_room" && server.failNextOpen) {
    server.failNextOpen = false;
    return { data: null, error: { message: "Failed to fetch" } };
  }
  if (fn === "get_chat_room")
    return {
      data: [
        {
          room_id: args._room_id,
          alias: room.alias,
          status: server.status,
          expires_at: room.expiresAt,
          topic: "room:abc",
        },
      ],
      error: null,
    };
  if (server.status !== "open") return { data: null, error: { message: "room_expired" } };
  if (fn === "get_room_messages") {
    const after = args._after as string | undefined;
    return { data: server.messages.filter((m) => !after || m.created_at >= after), error: null };
  }
  if (fn === "send_chat_message") {
    if (server.failNextSend) {
      server.failNextSend = false;
      return { data: null, error: { message: "network down" } };
    }
    const existing = server.messages.find((m) => m.client_msg_id === args._client_msg_id);
    if (existing) return { data: [existing], error: null };
    const row = {
      id: `srv-${server.messages.length + 1}`,
      sender_type: "user" as const,
      message: String(args._message),
      created_at: new Date(Date.now() + server.messages.length).toISOString(),
      client_msg_id: String(args._client_msg_id),
    };
    server.messages.push(row);
    return { data: [row], error: null };
  }
  return { data: null, error: { message: "unknown" } };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => ({
      abortSignal: () => Promise.resolve(answer(fn, args)),
    }),
    channel: () => {
      const ch = {
        on: (
          _t: string,
          filter: { event: string },
          cb: (p: { payload: Record<string, unknown> }) => void,
        ) => {
          handlers.set(filter.event, cb);
          return ch;
        },
        subscribe: (cb: (s: Status) => void) => {
          subscribeCb = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}));

const { useRoomChat } = await import("@/hooks/use-room-chat");

beforeEach(() => {
  server.status = "open";
  server.messages = fixtureMessages.map((m) => ({ ...m }));
  server.failNextOpen = false;
  server.failNextSend = false;
  server.rpcCalls = [];
  handlers.clear();
  subscribeCb = null;
  removeChannel.mockReset();
});

async function connected() {
  const hook = renderHook(() => useRoomChat(room));
  await waitFor(() => expect(subscribeCb).not.toBeNull());
  act(() => subscribeCb!("SUBSCRIBED"));
  await waitFor(() => expect(hook.result.current.state).toBe("connected"));
  return hook;
}

describe("useRoomChat", () => {
  it("connects, loads history in order, then reports Connected", async () => {
    const { result } = await connected();
    expect(result.current.lines.map((l) => l.message)).toEqual([
      "hello, is anyone there?",
      "I'm here. Take your time.",
    ]);
  });

  it("a sent message shows once: optimistic copy is replaced by the stored row", async () => {
    const { result } = await connected();
    act(() => {
      expect(result.current.send("  new message  ")).toBeNull();
    });
    // the realtime signal for our own insert races the send response
    act(() => handlers.get("message")?.({ payload: {} }));
    await waitFor(() =>
      expect(result.current.lines.some((l) => l.id.startsWith("srv-"))).toBe(true),
    );
    await waitFor(() =>
      expect(result.current.lines.filter((l) => l.message === "new message")).toHaveLength(1),
    );
    expect(result.current.lines.find((l) => l.message === "new message")?.pending).toBeUndefined();
  });

  it("validates before sending", async () => {
    const { result } = await connected();
    let err: string | null = null;
    act(() => {
      err = result.current.send("   ");
    });
    expect(err).toMatch(/write something/i);
    expect(server.rpcCalls).not.toContain("send_chat_message");
  });

  it("a failed send is marked, and retry reuses the same message id (no duplicate)", async () => {
    const { result } = await connected();
    server.failNextSend = true;
    act(() => {
      result.current.send("will fail first");
    });
    await waitFor(() =>
      expect(result.current.lines.find((l) => l.message === "will fail first")?.pending).toBe(
        "failed",
      ),
    );
    const clientId = result.current.lines.find(
      (l) => l.message === "will fail first",
    )!.client_msg_id!;
    act(() => result.current.retry(clientId));
    await waitFor(() =>
      expect(
        result.current.lines.find((l) => l.message === "will fail first")?.pending,
      ).toBeUndefined(),
    );
    expect(server.messages.filter((m) => m.client_msg_id === clientId)).toHaveLength(1);
  });

  it("realtime signal brings in another participant's message exactly once", async () => {
    const { result } = await connected();
    server.messages.push({
      id: "m3",
      sender_type: "admin",
      message: "from the mentor",
      created_at: new Date().toISOString(),
      client_msg_id: null,
    });
    act(() => handlers.get("message")?.({ payload: {} }));
    act(() => handlers.get("message")?.({ payload: {} }));
    await waitFor(() => expect(result.current.lines.filter((l) => l.id === "m3")).toHaveLength(1));
  });

  it("a mentor hiding a message removes it immediately", async () => {
    const { result } = await connected();
    act(() => handlers.get("moderated")?.({ payload: { id: "m1", hidden: true } }));
    expect(result.current.lines.find((l) => l.id === "m1")).toBeUndefined();
  });

  it("disconnects show Reconnecting, then recover", async () => {
    const { result } = await connected();
    act(() => subscribeCb!("CHANNEL_ERROR"));
    expect(result.current.state).toBe("reconnecting");
    act(() => subscribeCb!("SUBSCRIBED"));
    expect(result.current.state).toBe("connected");
  });

  it("reopens and subscribes when the server returns after an initial failure", async () => {
    server.failNextOpen = true;
    const { result } = renderHook(() => useRoomChat(room));
    await waitFor(() => expect(result.current.state).toBe("reconnecting"));
    expect(subscribeCb).toBeNull();

    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(subscribeCb).not.toBeNull());
    act(() => subscribeCb!("SUBSCRIBED"));
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.lines.map((line) => line.message)).toEqual([
      "hello, is anyone there?",
      "I'm here. Take your time.",
    ]);
    expect(server.rpcCalls.filter((name) => name === "get_chat_room")).toHaveLength(2);
  });

  it("a mentor closing the room ends the chat and tears down realtime", async () => {
    const { result } = await connected();
    act(() => handlers.get("room")?.({ payload: { status: "closed" } }));
    await waitFor(() => expect(result.current.state).toBe("closed"));
    expect(removeChannel).toHaveBeenCalled();
  });

  it("an expired room (database says so) refuses sends", async () => {
    const { result } = await connected();
    server.status = "expired";
    act(() => {
      result.current.send("too late");
    });
    await waitFor(() => expect(result.current.state).toBe("expired"));
    let err: string | null = null;
    act(() => {
      err = result.current.send("still too late");
    });
    expect(err).toMatch(/ended/i);
  });

  it("opening an already-expired room never subscribes", async () => {
    server.status = "expired";
    const { result } = renderHook(() => useRoomChat(room));
    await waitFor(() => expect(result.current.state).toBe("expired"));
    expect(subscribeCb).toBeNull();
  });

  it("unmounting removes the channel (no leaked subscription)", async () => {
    const { unmount } = await connected();
    unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
