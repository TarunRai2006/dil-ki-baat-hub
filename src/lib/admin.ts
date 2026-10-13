import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Confession, ConfessionStatus } from "@/lib/confession";

/** Which shelf of the moderation queue we are looking at. */
export type SubmissionView = "active" | "archived" | "trash";

export type SubmissionSort = "newest" | "oldest" | "updated";

export type SubmissionFilters = {
  search: string;
  status: ConfessionStatus | "all";
  category: string;
  intent: string;
  mood: number | null;
  featured: boolean;
  view: SubmissionView;
  from: string;
  to: string;
  sort: SubmissionSort;
  page: number;
};

export const PAGE_SIZE = 20;

/** Badge colours per moderation status. */
export const STATUS_TONE: Record<ConfessionStatus, string> = {
  Pending: "border-primary/40 bg-primary/10 text-primary",
  Reviewed: "border-sky-300/30 bg-sky-300/10 text-sky-200",
  Approved: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  Rejected: "border-destructive/40 bg-destructive/10 text-red-200",
};

export const DEFAULT_FILTERS: SubmissionFilters = {
  search: "",
  status: "all",
  category: "all",
  intent: "all",
  mood: null,
  featured: false,
  view: "active",
  from: "",
  to: "",
  sort: "newest",
  page: 0,
};

/**
 * List rows carry only what a row shows; the full record (notes, question,
 * review metadata) is fetched when a submission is opened. Browser ids and the
 * search column never leave the database.
 */
const LIST_COLUMNS =
  "id, created_at, updated_at, content, category, intent, emotional_state, highlight_on_instagram, nickname, alias, chat_enabled, status, is_featured, is_archived, deleted_at";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, age_group, community_question, chat_ttl, admin_notes, reviewed_at, reviewed_by`;

export type AdminSubmission = Omit<
  Confession,
  "search_text" | "anon_user_id" | "client_request_id"
> & { status: ConfessionStatus };

export type AdminSubmissionRow = Pick<
  AdminSubmission,
  | "id"
  | "created_at"
  | "updated_at"
  | "content"
  | "category"
  | "intent"
  | "emotional_state"
  | "highlight_on_instagram"
  | "nickname"
  | "alias"
  | "chat_enabled"
  | "status"
  | "is_featured"
  | "is_archived"
  | "deleted_at"
>;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** One page of submissions, filtered, sorted and counted inside the database. */
export async function fetchSubmissions(f: SubmissionFilters) {
  let q = supabase.from("submissions").select(LIST_COLUMNS, { count: "exact" });

  if (f.view === "trash") q = q.not("deleted_at", "is", null);
  else q = q.is("deleted_at", null).eq("is_archived", f.view === "archived");

  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.category !== "all") q = q.ilike("category", `%${escapeLike(f.category)}%`);
  if (f.intent !== "all") q = q.eq("intent", f.intent);
  if (f.mood !== null) q = q.eq("emotional_state", f.mood);
  if (f.featured) q = q.eq("is_featured", true);
  if (f.from) q = q.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q = q.lt("created_at", end.toISOString());
  }
  const term = f.search.trim();
  if (term) q = q.ilike("search_text", `%${escapeLike(term)}%`);

  const start = f.page * PAGE_SIZE;
  q =
    f.sort === "updated"
      ? q.order("updated_at", { ascending: false })
      : q.order("created_at", { ascending: f.sort === "oldest" });
  const { data, error, count } = await q
    .order("id", { ascending: true })
    .range(start, start + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as AdminSubmissionRow[], total: count ?? 0 };
}

export async function fetchSubmission(id: string) {
  const { data, error } = await supabase
    .from("submissions")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as AdminSubmission;
}

export type SubmissionPatch = {
  status?: ConfessionStatus;
  is_featured?: boolean;
  is_archived?: boolean;
  admin_notes?: string;
  deleted?: boolean;
};

/** Every moderation change goes through one admin-checked database function. */
export async function updateSubmission(id: string, patch: SubmissionPatch) {
  const { data, error } = await supabase.rpc("admin_update_submission", {
    _id: id,
    ...(patch.status !== undefined && { _status: patch.status }),
    ...(patch.is_featured !== undefined && { _is_featured: patch.is_featured }),
    ...(patch.is_archived !== undefined && { _is_archived: patch.is_archived }),
    ...(patch.admin_notes !== undefined && { _admin_notes: patch.admin_notes }),
    ...(patch.deleted !== undefined && { _deleted: patch.deleted }),
  });
  if (error) throw error;
  return data as AdminSubmission;
}

/** The success line an admin sees for a change. */
export function describePatch(patch: SubmissionPatch): string {
  if (patch.status) return `Marked ${patch.status.toLowerCase()}`;
  if (patch.is_featured !== undefined) return patch.is_featured ? "Featured" : "Unfeatured";
  if (patch.is_archived !== undefined) return patch.is_archived ? "Archived" : "Restored";
  if (patch.deleted !== undefined) return patch.deleted ? "Moved to trash" : "Restored from trash";
  if (patch.admin_notes !== undefined) return "Notes saved";
  return "Updated";
}

export type ModerationAction =
  | "STATUS_CHANGED"
  | "FEATURED"
  | "UNFEATURED"
  | "ARCHIVED"
  | "RESTORED"
  | "TRASHED"
  | "UNTRASHED"
  | "NOTE_UPDATED"
  | "update";

export type ModerationEntry = {
  id: number;
  created_at: string;
  action: ModerationAction;
  detail: Json;
};

export async function fetchModerationLog(id: string) {
  const { data, error } = await supabase
    .from("moderation_log")
    .select("id, created_at, action, detail")
    .eq("submission_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ModerationEntry[];
}

/** Human summary of one audit entry. */
export function describeLog(entry: ModerationEntry): string {
  const d =
    entry.detail && typeof entry.detail === "object" && !Array.isArray(entry.detail)
      ? (entry.detail as Record<string, Json>)
      : {};
  switch (entry.action) {
    case "STATUS_CHANGED":
      return `Status ${String(d.old)} → ${String(d.new)}`;
    case "FEATURED":
      return "Featured";
    case "UNFEATURED":
      return "Unfeatured";
    case "ARCHIVED":
      return "Archived";
    case "RESTORED":
      return "Restored from archive";
    case "TRASHED":
      return "Moved to trash";
    case "UNTRASHED":
      return "Restored from trash";
    case "NOTE_UPDATED":
      return "Notes edited";
    default:
      return "Updated";
  }
}

export type DashboardStats = {
  total: number;
  pending: number;
  reviewed: number;
  approved: number;
  rejected: number;
  archived: number;
  featured: number;
  trashed: number;
  today: number;
  week: number;
  pulse: number | null;
  live_chats: number;
  moods: { mood: number; count: number }[];
  categories: { name: string; count: number }[];
};

export async function fetchStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("admin_dashboard_stats");
  if (error) throw error;
  const s = (data ?? {}) as Partial<Record<keyof DashboardStats, unknown>>;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: n(s.total),
    pending: n(s.pending),
    reviewed: n(s.reviewed),
    approved: n(s.approved),
    rejected: n(s.rejected),
    archived: n(s.archived),
    featured: n(s.featured),
    trashed: n(s.trashed),
    today: n(s.today),
    week: n(s.week),
    pulse: s.pulse === null || s.pulse === undefined ? null : Number(s.pulse),
    live_chats: n(s.live_chats),
    moods: Array.isArray(s.moods) ? (s.moods as DashboardStats["moods"]) : [],
    categories: Array.isArray(s.categories) ? (s.categories as DashboardStats["categories"]) : [],
  };
}

/* ------------------------------------------------------------------ chat */

export type RoomView = "live" | "ended";

export type AdminRoom = {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  last_message_at: string | null;
  submissions: { alias: string; content: string; category: string } | null;
  chat_messages: { count: number }[];
  /** the newest message only (embedded, so the list is still one request) */
  last: { message: string; sender_type: string; created_at: string }[];
};

/** Live rooms, or rooms that expired / were closed, newest activity first. */
export async function fetchRooms(view: RoomView) {
  const now = new Date().toISOString();
  let q = supabase
    .from("chat_rooms")
    .select(
      "id, status, created_at, expires_at, last_message_at, submissions(alias, content, category), chat_messages(count), last:chat_messages(message, sender_type, created_at)",
    );
  q =
    view === "live"
      ? q.eq("status", "open").or(`expires_at.is.null,expires_at.gt.${now}`)
      : q.or(`status.neq.open,expires_at.lte.${now}`);
  const { data, error } = await q
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { referencedTable: "last", ascending: false })
    .limit(1, { referencedTable: "last" })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as AdminRoom[];
}

export async function setMessageHidden(id: string, hidden: boolean) {
  const { data, error } = await supabase.rpc("admin_set_message_hidden", {
    _message_id: id,
    _hidden: hidden,
  });
  if (error) throw error;
  return data;
}

/** Set just before a deliberate sign-out, so it is not mistaken for an expired session. */
export const adminSession = { leaving: false };

/**
 * When this mentor last read each room, kept on this device only (a reading
 * aid, not data: losing it just shows rooms as unread again).
 */
const SEEN_KEY = "dkb_admin_seen";
export type SeenMap = Record<string, string>;

export function loadSeen(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

export function saveSeen(seen: SeenMap) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage blocked (private mode): unread markers just reset next visit
  }
}

/** A room is unread when the visitor spoke last, after the mentor last looked. */
export function isUnread(room: AdminRoom, seen: SeenMap) {
  const last = room.last[0];
  return !!last && last.sender_type === "user" && last.created_at > (seen[room.id] ?? "");
}
