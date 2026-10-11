import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  chatMessageSchema,
  errorCode,
  friendlyError,
  timeoutSignal,
  type ChatMessage,
  type ChatRoom,
  type StoredRoom,
} from "@/lib/confession";

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "expired" | "closed" | "not_found";

/** A message on screen: stored on the server, or still on its way. */
export type ChatLine = ChatMessage & {
  /** set while a local message has not been confirmed by the server */
  pending?: "sending" | "failed";
  error?: string;
};

/** How often to re-read while realtime is down. Never runs while connected. */
const FALLBACK_POLL_MS = 8_000;

function byTime(a: ChatLine, b: ChatLine) {
  return a.created_at === b.created_at
    ? a.id.localeCompare(b.id)
    : a.created_at < b.created_at
      ? -1
      : 1;
}

/**
 * One anonymous room, end to end: reads through the token-checked database
 * functions, listens for the content-free realtime signal, and reconciles
 * optimistic messages by their client id so nothing ever shows twice.
 */
export function useRoomChat(room: StoredRoom | null) {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [meta, setMeta] = useState<ChatRoom | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const alive = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncing = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  /** Merge server rows: dedupe by id and drop any pending copy with the same client id. */
  const merge = useCallback((rows: ChatMessage[]) => {
    if (!rows.length) return;
    setLines((prev) => {
      const ids = new Set(prev.filter((l) => !l.pending).map((l) => l.id));
      const confirmed = new Set(rows.map((r) => r.client_msg_id).filter(Boolean));
      const kept = prev.filter((l) => !(l.pending && confirmed.has(l.client_msg_id)));
      const fresh = rows.filter((r) => !ids.has(r.id));
      return fresh.length || kept.length !== prev.length ? [...kept, ...fresh].sort(byTime) : prev;
    });
  }, []);

  const endWith = useCallback((code: string | null) => {
    if (code === "room_expired") setState("expired");
    else if (code === "room_not_found") setState("not_found");
  }, []);

  /** Fetch whatever is newer than the last confirmed message. Coalesces calls. */
  const sync = useCallback(async () => {
    if (!room) return;
    if (syncing.current) {
      again.current = true;
      return syncing.current;
    }
    const run = async () => {
      do {
        again.current = false;
        const after = linesRef.current.filter((l) => !l.pending).at(-1)?.created_at;
        const { data, error } = await supabase
          .rpc("get_room_messages", { _room_id: room.roomId, _token: room.token, _after: after })
          .abortSignal(timeoutSignal(12_000));
        if (!alive.current) return;
        if (error) {
          endWith(errorCode(error));
          return;
        }
        merge((data ?? []) as ChatMessage[]);
      } while (again.current && alive.current);
    };
    syncing.current = run().finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }, [room, merge, endWith]);

  /** Re-read the whole visible history (after a mentor restores a hidden message). */
  const reload = useCallback(async () => {
    if (!room) return;
    const { data, error } = await supabase
      .rpc("get_room_messages", { _room_id: room.roomId, _token: room.token })
      .abortSignal(timeoutSignal(12_000));
    if (!alive.current) return;
    if (error) return endWith(errorCode(error));
    const rows = (data ?? []) as ChatMessage[];
    setLines((prev) => [...rows, ...prev.filter((l) => l.pending)].sort(byTime));
  }, [room, endWith]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollRef = useRef(0);
  const expiryRef = useRef(0);
  /** Stop every background activity for this room: channel, polling, timers. */
  const teardown = useCallback(() => {
    window.clearInterval(pollRef.current);
    window.clearTimeout(expiryRef.current);
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // open the room, load history, subscribe; everything is torn down on unmount
  useEffect(() => {
    alive.current = true;
    if (!room) return;
    setLines([]);
    setState("connecting");
    // per-run flag: under Strict Mode (and on fast room switches) a run that was
    // already cleaned up must never go on to open a channel nobody will remove
    let cancelled = false;

    const stopPolling = () => window.clearInterval(pollRef.current);
    const startPolling = () => {
      stopPolling();
      pollRef.current = window.setInterval(() => void sync(), FALLBACK_POLL_MS);
    };

    (async () => {
      const { data, error } = await supabase
        .rpc("get_chat_room", { _room_id: room.roomId, _token: room.token })
        .abortSignal(timeoutSignal(12_000));
      if (!alive.current || cancelled) return;
      const row = data?.[0];
      if (error || !row) {
        const code = errorCode(error);
        if (code === "room_not_found" || (!error && !row)) setState("not_found");
        else {
          // network trouble: keep trying quietly
          setState("reconnecting");
          startPolling();
        }
        return;
      }
      const info: ChatRoom = {
        roomId: row.room_id,
        alias: row.alias,
        status: row.status as ChatRoom["status"],
        expiresAt: row.expires_at,
        topic: row.topic,
      };
      setMeta(info);
      if (info.status !== "open") {
        setState(info.status === "closed" ? "closed" : "expired");
        return;
      }

      // the server is the judge of expiry; this only re-asks it at the right moment
      if (info.expiresAt) {
        const ms = new Date(info.expiresAt).getTime() - Date.now();
        expiryRef.current = window.setTimeout(() => void sync(), Math.max(0, ms) + 1500);
      }

      await sync();
      if (!alive.current || cancelled) return;

      // signals carry no content: each one only prompts a read through the
      // token-checked functions, so a forged broadcast cannot inject anything
      channelRef.current = supabase
        .channel(info.topic, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "message" }, () => void sync())
        .on("broadcast", { event: "moderated" }, ({ payload }) => {
          const id = typeof payload?.id === "string" ? payload.id : null;
          if (payload?.hidden === true && id) setLines((prev) => prev.filter((l) => l.id !== id));
          else void reload();
        })
        .on("broadcast", { event: "room" }, ({ payload }) => {
          if (payload?.status === "closed") setState("closed");
          else void sync();
        })
        .subscribe((status) => {
          if (!alive.current || cancelled) return;
          const terminal = ["expired", "closed", "not_found"].includes(stateRef.current);
          if (terminal) return;
          if (status === "SUBSCRIBED") {
            setState("connected");
            stopPolling();
            void sync(); // catch up on anything sent while we were away
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setState("reconnecting");
            startPolling(); // supabase-js rejoins with backoff; poll meanwhile
          } else if (status === "CLOSED") {
            setState("disconnected");
            startPolling();
          }
        });
    })();

    const resync = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);

    return () => {
      cancelled = true;
      alive.current = false;
      teardown();
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [room, sync, reload, teardown]);

  // once the room is over, stop all background work (realtime, polling, timers)
  useEffect(() => {
    if (state === "expired" || state === "closed" || state === "not_found") {
      teardown();
      setLines((prev) => prev.filter((l) => !l.pending));
    }
  }, [state, teardown]);

  const deliver = useCallback(
    async (text: string, clientId: string) => {
      if (!room) return;
      const { data, error } = await supabase
        .rpc("send_chat_message", {
          _room_id: room.roomId,
          _token: room.token,
          _message: text,
          _client_msg_id: clientId,
        })
        .abortSignal(timeoutSignal(12_000));
      if (!alive.current) return;
      if (error || !data?.[0]) {
        const code = errorCode(error);
        endWith(code);
        setLines((prev) =>
          prev.map((l) =>
            l.client_msg_id === clientId
              ? {
                  ...l,
                  pending: "failed",
                  error: friendlyError(error, "Message failed. Tap to retry."),
                }
              : l,
          ),
        );
        return;
      }
      merge(data as ChatMessage[]);
      setLastSent(clientId);
    },
    [room, merge, endWith],
  );

  /** Returns an error message for the composer, or null when the message is on its way. */
  const send = useCallback(
    (raw: string): string | null => {
      const parsed = chatMessageSchema.safeParse(raw);
      if (!parsed.success) return parsed.error.issues[0].message;
      if (stateRef.current === "expired" || stateRef.current === "closed")
        return "This chat has ended.";
      const clientId = crypto.randomUUID();
      setLines((prev) => [
        ...prev,
        {
          id: `local-${clientId}`,
          client_msg_id: clientId,
          sender_type: "user",
          message: parsed.data,
          created_at: new Date().toISOString(),
          pending: "sending",
        },
      ]);
      void deliver(parsed.data, clientId);
      return null;
    },
    [deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const line = linesRef.current.find((l) => l.client_msg_id === clientId);
      if (!line) return;
      setLines((prev) =>
        prev.map((l) =>
          l.client_msg_id === clientId ? { ...l, pending: "sending", error: undefined } : l,
        ),
      );
      // same client id: if the first attempt actually landed, the server returns that row
      void deliver(line.message, clientId);
    },
    [deliver],
  );

  return { state, meta, lines, send, retry, lastSent };
}
