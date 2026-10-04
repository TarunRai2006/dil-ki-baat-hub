// Shared, deterministic test data. Shapes mirror the database rows the app
// reads (see supabase/migrations) so unit, component and browser tests agree.
import type { AdminSubmission, AdminSubmissionRow, DashboardStats } from "@/lib/admin";
import type { ChatMessage, StoredRoom } from "@/lib/confession";

export const FIXED_NOW = Date.parse("2026-10-04T10:00:00.000Z");
const iso = (msAgo: number) => new Date(FIXED_NOW - msAgo).toISOString();
const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A complete confession as the admin detail view reads it. */
export function makeSubmission(n: number, over: Partial<AdminSubmission> = {}): AdminSubmission {
  return {
    id: uuid(n),
    created_at: iso(n * 3_600_000),
    updated_at: iso(n * 600_000),
    content: `Confession number ${n}, written late at night.`,
    category: n % 2 ? "Career" : "Family",
    intent: n % 3 ? "Advice" : "Both",
    emotional_state: (n % 5) + 1,
    community_question: null,
    highlight_on_instagram: "Maybe",
    nickname: null,
    alias: `Gumnam Dost #${100 + n}`,
    chat_enabled: false,
    chat_ttl: "never",
    status: "Pending",
    admin_notes: null,
    is_featured: false,
    is_archived: false,
    deleted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    ...over,
  };
}

/** The richest record: every optional field filled, multi-line content, live chat. */
export const tiredOwl = makeSubmission(1, {
  content: "I have been pretending to be okay at work for months.\nIt is wearing me down.",
  category: "Career",
  intent: "Advice",
  emotional_state: 2,
  community_question: "Should I talk to my manager?",
  highlight_on_instagram: "Yes",
  nickname: "Tired Owl",
  chat_enabled: true,
  chat_ttl: "24h",
});

export const submissions: AdminSubmission[] = [
  tiredOwl,
  ...Array.from({ length: 44 }, (_, i) => makeSubmission(i + 2)),
];

export function toRow(s: AdminSubmission): AdminSubmissionRow {
  const { community_question, chat_ttl, admin_notes, reviewed_at, reviewed_by, ...row } = s;
  void community_question;
  void chat_ttl;
  void admin_notes;
  void reviewed_at;
  void reviewed_by;
  return row;
}

export const stats: DashboardStats = {
  total: 45,
  pending: 44,
  reviewed: 1,
  approved: 0,
  rejected: 0,
  archived: 0,
  featured: 0,
  trashed: 0,
  today: 3,
  week: 21,
  pulse: 3,
  live_chats: 1,
  moods: [1, 2, 3, 4, 5].map((mood) => ({ mood, count: 9 })),
  categories: [
    { name: "Career", count: 23 },
    { name: "Family", count: 22 },
  ],
};

export const room: StoredRoom = {
  roomId: tiredOwl.id,
  token: "a".repeat(48),
  alias: tiredOwl.alias,
  expiresAt: new Date(FIXED_NOW + 86_400_000).toISOString(),
};

export const messages: ChatMessage[] = [
  {
    id: "m1",
    sender_type: "user",
    message: "hello, is anyone there?",
    created_at: iso(60_000),
    client_msg_id: "c1",
  },
  {
    id: "m2",
    sender_type: "admin",
    message: "I'm here. Take your time.",
    created_at: iso(30_000),
    client_msg_id: "c2",
  },
];

/** A valid form submission, as the visitor fills it. */
export const validConfession = {
  content: "I have been pretending to be okay at work for months.\nIt is wearing me down.",
  category: "Career",
  intent: "Advice",
  emotional_state: 2,
  community_question: "Should I talk to my manager?",
  highlight_on_instagram: "Yes",
  nickname: "Tired Owl",
  chat_enabled: true,
  chat_ttl: "24h",
};

export const whispers = [
  "I finally told my sister. She just hugged me.",
  "I am tired in a way sleep does not fix, but writing this helped.",
];
