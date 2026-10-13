import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  CATEGORIES,
  HIGHLIGHT_OPTIONS,
  INTENTS,
  TTL_OPTIONS,
  getAnonUserId,
} from "@/lib/dilkibaat";

/* ------------------------------------------------------------------ types */

export const CONFESSION_STATUSES = ["Pending", "Reviewed", "Approved", "Rejected"] as const;
export type ConfessionStatus = (typeof CONFESSION_STATUSES)[number];

/** A stored confession, exactly as the admin reads it. */
export type Confession = Database["public"]["Tables"]["submissions"]["Row"];

export type ChatRoomStatus = "open" | "closed" | "expired";

/** What an anonymous room holder can see about their own room. */
export type ChatRoom = {
  roomId: string;
  alias: string;
  status: ChatRoomStatus;
  expiresAt: string | null;
  topic: string;
};

/** A chat message as exposed to participants: no room, user or session ids. */
export type ChatMessage = {
  id: string;
  sender_type: "user" | "admin";
  message: string;
  created_at: string;
  client_msg_id: string | null;
};

export type AdminUser = { user: User; isAdmin: boolean };

/* ------------------------------------------------------------- validation */

export const CONTENT_MIN = 10;
export const CONTENT_MAX = 2000;
export const QUESTION_MAX = 200;
export const NICKNAME_MAX = 40;
export const MESSAGE_MAX = 1000;
export const NOTES_MAX = 5000;

const categoryList = CATEGORIES as unknown as [string, ...string[]];

/**
 * Client-side mirror of the database rules in `submit_confession`. It only
 * exists for instant feedback; the database re-checks every field.
 */
/** Postgres text cannot store NUL; drop it and other control characters, keeping tab and line breaks. */
const stripControls = (v: string) =>
  Array.from(v)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127);
    })
    .join("");

export const confessionSchema = z.object({
  content: z
    .string()
    .transform(stripControls)
    .pipe(
      z
        .string()
        .trim()
        .min(CONTENT_MIN, "Even one honest sentence is enough — but we need something to hold.")
        .max(CONTENT_MAX, `Please keep it under ${CONTENT_MAX} characters.`),
    ),
  // one category, or up to four joined with commas (the older multi-select forms)
  category: z.string().refine((v) => {
    const parts = v.split(",").map((p) => p.trim());
    return parts.length >= 1 && parts.length <= 4 && parts.every((p) => categoryList.includes(p));
  }, "Please pick where it hurts from the list."),
  intent: z.enum(INTENTS.map((i) => i.value) as [string, ...string[]]),
  emotional_state: z.number().int().min(1).max(5),
  community_question: z
    .string()
    .trim()
    .max(QUESTION_MAX, `Keep the question under ${QUESTION_MAX} characters.`),
  highlight_on_instagram: z.enum(HIGHLIGHT_OPTIONS as unknown as [string, ...string[]]),
  nickname: z
    .string()
    .trim()
    .max(NICKNAME_MAX, `Nicknames can be up to ${NICKNAME_MAX} characters.`),
  chat_enabled: z.boolean(),
  chat_ttl: z.enum(TTL_OPTIONS.map((t) => t.value) as [string, ...string[]]),
});
export type ConfessionInput = z.input<typeof confessionSchema>;

export const chatMessageSchema = z
  .string()
  .transform(stripControls)
  .pipe(
    z
      .string()
      .trim()
      .min(1, "Write something first.")
      .max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters.`),
  );

/* ----------------------------------------------------------------- errors */

const FRIENDLY: Record<string, string> = {
  rate_limited:
    "You have shared a lot in a short time. Take a breath and try again in a few minutes.",
  invalid_content: "Your words need to be between 10 and 2000 characters.",
  invalid_category: "Please pick where it hurts from the list.",
  invalid_intent: "Please choose what you want back.",
  invalid_emotional_state: "Please set how heavy today feels.",
  invalid_question: `Keep the question under ${QUESTION_MAX} characters.`,
  invalid_highlight: "Please choose whether we can share it.",
  invalid_nickname: `Nicknames can be up to ${NICKNAME_MAX} characters.`,
  invalid_chat: "Please choose how long the chat should last.",
  invalid_age_group: "Please confirm that you are at least 16.",
  minor_public_sharing_disabled: "Public sharing is off for visitors aged 16–17.",
  invalid_request: "Something about that request was off. Please refresh and try again.",
  active_chat_exists:
    "You already have an active chat on this browser. Open it before starting another story.",
  message_empty: "Write something first.",
  message_too_long: `Messages can be up to ${MESSAGE_MAX} characters.`,
  room_expired: "This chat has ended. It disappeared as promised.",
  room_not_found: "This chat could not be found. It may have ended.",
  not_authorized: "You do not have permission to do that.",
  invalid_status: "That status is not allowed.",
  invalid_notes: `Notes can be up to ${NOTES_MAX} characters.`,
  not_found: "That confession no longer exists.",
};

/** The machine code a database function raised, if any. */
export function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  const match = /^[a-z_]+$/.exec(message.trim());
  if (match && match[0] in FRIENDLY) return match[0];
  if ("name" in err && err.name === "AbortError") return "timeout";
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(message)) return "network";
  if ("code" in err && (err.code === "42501" || err.code === "PGRST301")) return "not_authorized";
  return null;
}

/** Never show a raw PostgrestError to a visitor. */
export function friendlyError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const code = errorCode(err);
  if (code === "timeout") return "This is taking too long. Check your connection and try again.";
  if (code === "network")
    return "We could not reach the server. Check your connection and try again.";
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  return fallback;
}

/** Abort a request that hangs instead of leaving the user waiting forever. */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/* ------------------------------------------------------------- submission */

export type SubmitResult = {
  submissionId: string;
  alias: string;
  room: StoredRoom | null;
};

/**
 * Sends a confession through the validated database function. The same
 * `requestId` always yields the same stored row, so double clicks and network
 * retries can never create duplicates.
 */
export async function submitConfession(
  input: ConfessionInput,
  requestId: string,
  ageGroup: "16-17" | "18+",
): Promise<SubmitResult> {
  const data = confessionSchema.parse(input);
  const { data: rows, error } = await supabase
    .rpc("submit_confession_v2", {
      _content: data.content,
      _category: data.category,
      _intent: data.intent,
      _emotional_state: data.emotional_state,
      _community_question: data.community_question,
      _highlight_on_instagram: data.highlight_on_instagram,
      _nickname: data.nickname,
      _chat_enabled: data.chat_enabled,
      _chat_ttl: data.chat_ttl,
      _anon_user_id: getAnonUserId(),
      _client_request_id: requestId,
      _age_group: ageGroup,
    })
    .abortSignal(timeoutSignal(15_000));
  if (error) throw error;
  const row = rows?.[0];
  if (!row) throw new Error("invalid_request");

  let room: StoredRoom | null = null;
  if (row.room_id && row.room_token) {
    room = {
      roomId: row.room_id,
      token: row.room_token,
      alias: row.alias,
      expiresAt: row.room_expires_at,
    };
    saveRoom(room);
  }
  if (data.chat_enabled && !room) throw new Error("invalid_request");
  return { submissionId: row.submission_id, alias: row.alias, room };
}

/* ------------------------------------------------------ anonymous rooms */

/** The room capability kept in this browser only. The token is the key. */
export type StoredRoom = {
  roomId: string;
  token: string;
  alias: string;
  expiresAt: string | null;
};

export const ROOMS_KEY = "dkb_chat_rooms";

function readRooms(): StoredRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ROOMS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is StoredRoom =>
        !!r &&
        typeof r === "object" &&
        typeof (r as StoredRoom).roomId === "string" &&
        typeof (r as StoredRoom).token === "string",
    );
  } catch {
    return [];
  }
}

export function saveRoom(room: StoredRoom) {
  if (typeof window === "undefined") return;
  const rooms = [room, ...readRooms().filter((r) => r.roomId !== room.roomId)].slice(0, 5);
  try {
    window.localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch {
    // storage full or blocked: the room still works for this page view
  }
}

export function forgetRoom(roomId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ROOMS_KEY,
      JSON.stringify(readRooms().filter((r) => r.roomId !== roomId)),
    );
  } catch {
    // ignore
  }
}

/** End a room on the server before removing its access token from this browser. */
export async function endChatRoom(room: StoredRoom): Promise<void> {
  const { error } = await supabase
    .rpc("end_chat_room", { _room_id: room.roomId, _token: room.token })
    .abortSignal(timeoutSignal(12_000));
  if (error) throw error;
  forgetRoom(room.roomId);
}

/** Most recent room that has not passed its expiry (the server still decides). */
export function latestLiveRoom(): StoredRoom | null {
  const now = Date.now();
  return readRooms().find((r) => !r.expiresAt || new Date(r.expiresAt).getTime() > now) ?? null;
}

/* ---------------------------------------------------------------- whispers */

/**
 * Words the public may read: only confessions whose writers said "Yes" to
 * anonymous sharing, that a mentor approved and featured. Excerpts only.
 */
export async function fetchWhispers(): Promise<string[]> {
  const { data, error } = await supabase
    .rpc("get_public_whispers", { _limit: 12 })
    .abortSignal(timeoutSignal(10_000));
  if (error) return [];
  return (data ?? []).map((w) => w.excerpt);
}
