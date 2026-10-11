import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, FileText, Loader2, Lock, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MESSAGE_MAX, chatMessageSchema, friendlyError } from "@/lib/confession";
import {
  fetchRooms,
  isUnread,
  setMessageHidden,
  type AdminRoom,
  type RoomView,
  type SeenMap,
} from "@/lib/admin";

const QUICK_REPLIES = [
  "Thank you for trusting us with this. You're safe here. 🤍",
  "That sounds really heavy. Do you want advice, or would you rather just be heard right now?",
  "You are not alone in feeling this way — many people carry the same silence.",
  "Take your time. I'm here and I'm listening.",
  "If things ever feel unbearable, please call Tele-MANAS at 14416 — free, 24×7.",
];

type Message = {
  id: string;
  sender_type: string;
  message: string;
  created_at: string;
  client_msg_id: string | null;
  is_hidden: boolean;
};

async function fetchRoomMessages(roomId: string) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, sender_type, message, created_at, client_msg_id, is_hidden")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(500);
  if (error) throw error;
  // newest 500, shown oldest first
  return ((data ?? []) as Message[]).reverse();
}

function upsertMessage(list: Message[] | undefined, m: Message) {
  const prev = list ?? [];
  const i = prev.findIndex((x) => x.id === m.id);
  if (i >= 0) return prev.map((x, k) => (k === i ? { ...x, ...m } : x));
  return [...prev, m].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "14:05" today, "3 Oct" before that: enough to scan a list by. */
const short = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function roomEnds(r: AdminRoom) {
  if (r.status !== "open") return r.status;
  if (!r.expires_at) return "no expiry";
  return `${new Date(r.expires_at).getTime() > Date.now() ? "ends" : "ended"} ${fmt(r.expires_at)}`;
}

/** Mentor side of the chats: live and ended rooms, replies, hide/unhide, close. */
export function AdminChat({
  activeRoom,
  onSelectRoom,
  onOpenSubmission,
  seen,
  onSeen,
}: {
  activeRoom: string | null;
  onSelectRoom: (id: string | null) => void;
  /** a room belongs to exactly one confession (same id) */
  onOpenSubmission: (id: string) => void;
  seen: SeenMap;
  onSeen: (roomId: string, at: string) => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<RoomView>("live");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const rooms = useQuery({ queryKey: ["chat-rooms", view], queryFn: () => fetchRooms(view) });
  const messages = useQuery({
    queryKey: ["chat-messages", activeRoom],
    enabled: !!activeRoom,
    queryFn: () => fetchRoomMessages(activeRoom!),
  });

  // one subscription for the open room only, swapped when the room changes
  useEffect(() => {
    if (!activeRoom) return;
    const channel = supabase
      .channel(`admin-room-${activeRoom}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${activeRoom}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const m = payload.new as Message;
          qc.setQueryData<Message[]>(["chat-messages", activeRoom], (list) =>
            upsertMessage(list, m),
          );
          if (payload.eventType === "INSERT")
            void qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        },
      )
      .subscribe((status) => {
        // after a (re)connect, re-read so nothing sent meanwhile is missed
        if (status === "SUBSCRIBED")
          void qc.invalidateQueries({ queryKey: ["chat-messages", activeRoom] });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeRoom, qc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.data?.length]);

  // reading the open room marks everything in it, including what arrives while open, as seen
  const newest = messages.data?.at(-1)?.created_at;
  useEffect(() => {
    if (activeRoom && newest && newest > (seen[activeRoom] ?? "")) onSeen(activeRoom, newest);
  }, [activeRoom, newest, seen, onSeen]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const parsed = chatMessageSchema.parse(text);
      const { data, error } = await supabase.rpc("admin_send_chat_message", {
        _room_id: activeRoom!,
        _message: parsed,
        _client_msg_id: crypto.randomUUID(),
      });
      if (error) throw error;
      return data as Message;
    },
    onSuccess: (m) => {
      qc.setQueryData<Message[]>(["chat-messages", activeRoom], (list) => upsertMessage(list, m));
      setDraft("");
    },
    onError: (err) => {
      toast.error(friendlyError(err, "Unable to send message. Please try again."));
      void qc.invalidateQueries({ queryKey: ["chat-rooms"] });
    },
  });

  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => setMessageHidden(id, hidden),
    onMutate: ({ id, hidden }) => {
      const prev = qc.getQueryData<Message[]>(["chat-messages", activeRoom]);
      qc.setQueryData<Message[]>(["chat-messages", activeRoom], (list) =>
        list?.map((m) => (m.id === id ? { ...m, is_hidden: hidden } : m)),
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(["chat-messages", activeRoom], ctx?.prev);
      toast.error(friendlyError(err, "Could not update that message."));
    },
    onSuccess: (_d, { hidden }) => toast.success(hidden ? "Message hidden" : "Message restored"),
  });

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_set_room_status", {
        _room_id: activeRoom!,
        _status: "closed",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat closed");
      void qc.invalidateQueries({ queryKey: ["chat-rooms"] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const list = rooms.data ?? [];
  const current = list.find((r) => r.id === activeRoom);
  const isLive =
    !!current &&
    current.status === "open" &&
    (!current.expires_at || new Date(current.expires_at).getTime() > Date.now());

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="rounded-2xl glass-panel p-3">
        <div className="flex gap-1 rounded-full border border-cream/10 p-1" role="tablist">
          {(["live", "ended"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-full px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-[0.2em] transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-cream"
              }`}
            >
              {v === "live" ? "Live rooms" : "Expired / closed"}
            </button>
          ))}
        </div>
        <ScrollArea className="mt-3 h-[28rem]">
          <div className="space-y-1 pr-2">
            {rooms.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            {rooms.isError && (
              <p className="px-2 text-sm text-muted-foreground">
                Unable to load chats.{" "}
                <button className="underline" onClick={() => void rooms.refetch()}>
                  Retry
                </button>
              </p>
            )}
            {!rooms.isLoading && !rooms.isError && list.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {view === "live" ? "No live chats right now." : "No ended chats yet."}
              </p>
            )}
            {list.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRoom(r.id)}
                aria-current={activeRoom === r.id}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  activeRoom === r.id ? "bg-primary text-primary-foreground" : "hover:bg-accent/20"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {isUnread(r, seen) && activeRoom !== r.id && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                        role="img"
                      />
                    )}
                    <span className="truncate">{r.submissions?.alias ?? "Anonymous"}</span>
                  </span>
                  <span className="shrink-0 text-[0.65rem] opacity-70">
                    {short(r.last[0]?.created_at ?? r.created_at)}
                  </span>
                </span>
                <span className="block truncate text-xs opacity-80">
                  {r.last[0]
                    ? `${r.last[0].sender_type === "admin" ? "You: " : ""}${r.last[0].message}`
                    : "No messages yet"}
                </span>
                <span className="block text-[0.65rem] opacity-60">
                  {r.chat_messages[0]?.count ?? 0} msgs · {roomEnds(r)}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex h-[34rem] flex-col rounded-2xl glass-panel">
        {!activeRoom ? (
          <p className="m-auto text-sm text-muted-foreground">Select a room to read or reply.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <div>
                <p className="font-display text-lg text-primary">
                  {current?.submissions?.alias ?? "Anonymous"}
                </p>
                <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {isLive ? "Live" : "Ended — read only"}
                  {current?.submissions?.category ? ` · ${current.submissions.category}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-2"
                onClick={() => onOpenSubmission(activeRoom)}
              >
                <FileText className="size-4" aria-hidden="true" /> View submission
              </Button>
              {isLive && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="gap-2" disabled={close.isPending}>
                      <Lock className="size-4" aria-hidden="true" /> Close chat
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="glass-panel">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Close this chat?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The writer will see that the chat has ended and nobody can send further
                        messages.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => close.mutate()}>
                        Close chat
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </header>
            {current?.submissions?.content && (
              <details className="group border-b border-border px-4 py-2 text-sm">
                <summary className="cursor-pointer list-none font-mono text-[0.55rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-cream">
                  What they wrote <span className="group-open:hidden">· show</span>
                  <span className="hidden group-open:inline">· hide</span>
                </summary>
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-cream/85">
                  {current.submissions.content}
                </p>
              </details>
            )}
            <ScrollArea className="min-h-0 flex-1 p-4">
              <div role="log" aria-label="Conversation" className="space-y-3">
                {messages.isLoading && <Skeleton className="h-10 w-1/2" />}
                {messages.isError && (
                  <p className="text-sm text-muted-foreground">
                    Unable to load messages. Please try again.
                  </p>
                )}
                {messages.data?.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No messages yet. Start the conversation.
                  </p>
                )}
                {messages.data?.map((m) => (
                  <div
                    key={m.id}
                    className={`group flex items-end gap-2 ${m.sender_type === "admin" ? "flex-row-reverse" : ""}`}
                  >
                    <div
                      className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                        m.sender_type === "admin"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm border border-cream/10 bg-cream/[0.06] text-cream"
                      } ${m.is_hidden ? "opacity-40 line-through" : ""}`}
                    >
                      {m.message}
                    </div>
                    <button
                      type="button"
                      onClick={() => hide.mutate({ id: m.id, hidden: !m.is_hidden })}
                      aria-label={m.is_hidden ? "Restore message" : "Hide message"}
                      title={m.is_hidden ? "Restore message" : "Hide message"}
                      className="rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:text-cream focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      {m.is_hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </button>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            </ScrollArea>

            {isLive && (
              <>
                <div className="flex flex-wrap gap-2 border-t border-border p-3">
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={send.isPending}
                      onClick={() => send.mutate(q)}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
                    >
                      {q.length > 42 ? `${q.slice(0, 42)}…` : q}
                    </button>
                  ))}
                </div>
                <form
                  className="flex items-center gap-2 border-t border-border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) send.mutate(draft);
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Reply as mentor…"
                    maxLength={MESSAGE_MAX}
                    aria-label="Reply"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!draft.trim() || send.isPending}
                    aria-label="Send reply"
                  >
                    {send.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </form>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
