import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, RotateCw, Send, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRoomChat, type ConnectionState } from "@/hooks/use-room-chat";
import { MESSAGE_MAX, type StoredRoom } from "@/lib/confession";

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
  expired: "Room expired",
  closed: "Chat closed",
  not_found: "Chat unavailable",
};

const STATE_TONE: Record<ConnectionState, string> = {
  connecting: "bg-primary/60 animate-pulse",
  connected: "bg-emerald-400",
  reconnecting: "bg-ember animate-pulse",
  disconnected: "bg-destructive",
  expired: "bg-muted-foreground",
  closed: "bg-muted-foreground",
  not_found: "bg-muted-foreground",
};

function expiryLabel(expiresAt: string | null) {
  if (!expiresAt) return "Never disappears";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Disappeared";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `Disappears in ${h}h ${m}m` : `Disappears in ${Math.max(1, m)}m`;
}

/** The conversation itself: header, thread and composer. Shared by widget and sheet. */
export function ChatThread({
  room,
  onClose,
  onEnded,
}: {
  room: StoredRoom;
  onClose?: () => void;
  /** offered once the chat is over: forget this room so a new one can begin */
  onEnded?: () => void;
}) {
  const { state, meta, lines, send, retry, lastSent } = useRoomChat(room);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ended = state === "expired" || state === "closed" || state === "not_found";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  // a short "Message sent" acknowledgement, then quiet again
  const [sentFlash, setSentFlash] = useState(false);
  useEffect(() => {
    if (!lastSent) return;
    setSentFlash(true);
    const t = window.setTimeout(() => setSentFlash(false), 1800);
    return () => window.clearTimeout(t);
  }, [lastSent]);

  const submit = () => {
    const problem = send(draft);
    setHint(problem);
    if (!problem) setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-cream/10 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight text-primary">
            {meta?.alias ?? room.alias}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
              <span className={`size-1.5 rounded-full ${STATE_TONE[state]}`} aria-hidden="true" />
              {sentFlash && state === "connected" ? "Message sent" : STATE_LABEL[state]}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Timer className="size-3" aria-hidden="true" />
              {expiryLabel(meta?.expiresAt ?? room.expiresAt)}
            </span>
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
            <X className="size-4" />
          </Button>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1 px-4 py-3">
        <div className="space-y-3" aria-live="polite" aria-relevant="additions">
          {lines.length === 0 && !ended && (
            <div className="py-6 text-center">
              <p className="font-display text-base italic text-cream/85">
                You&apos;re in an anonymous room.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Start the conversation.</p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground/80">
                A mentor may reply here. Please keep real names and contact details out of your
                messages.
              </p>
            </div>
          )}
          {lines.map((m) => (
            <div
              key={m.client_msg_id ?? m.id}
              className={`flex flex-col ${m.sender_type === "admin" ? "items-start" : "items-end"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  m.sender_type === "admin"
                    ? "rounded-bl-sm border border-cream/10 bg-cream/[0.06] text-cream"
                    : "rounded-br-sm bg-primary text-primary-foreground"
                } ${m.pending === "sending" ? "opacity-70" : ""} ${m.pending === "failed" ? "ring-1 ring-destructive/70" : ""}`}
              >
                {m.message}
              </div>
              {m.pending === "sending" && (
                <span className="mt-1 inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Sending
                </span>
              )}
              {m.pending === "failed" && m.client_msg_id && (
                <button
                  type="button"
                  onClick={() => retry(m.client_msg_id!)}
                  className="mt-1 inline-flex items-center gap-1 text-[0.65rem] text-destructive hover:underline"
                >
                  <RotateCw className="size-3" aria-hidden="true" />
                  {m.error ?? "Message failed."} Retry
                </button>
              )}
              {!m.pending && m.sender_type === "user" && m.client_msg_id === lastSent && (
                <span className="mt-1 inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                  <Check className="size-3" aria-hidden="true" /> Sent
                </span>
              )}
            </div>
          ))}
          {ended && (
            <div className="space-y-3">
              <p className="flex items-start gap-2 rounded-xl border border-cream/10 bg-background/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                {state === "expired"
                  ? "This chat has disappeared as promised. Nothing more can be sent here."
                  : state === "closed"
                    ? "A mentor has closed this chat. You can always write again."
                    : "This chat could not be found. It may have ended."}
              </p>
              {onEnded && (
                <Button size="sm" variant="secondary" className="w-full" onClick={onEnded}>
                  Close this chat · write again any time
                </Button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form
        className="border-t border-cream/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            maxLength={MESSAGE_MAX}
            disabled={ended}
            onChange={(e) => {
              setDraft(e.target.value);
              if (hint) setHint(null);
            }}
            placeholder={ended ? "This chat has ended" : "Say it however it comes out…"}
            aria-label="Message"
            className="border-cream/12 bg-background/40 text-base text-cream sm:text-sm placeholder:text-muted-foreground/70"
          />
          <Button
            type="submit"
            size="icon"
            disabled={ended || !draft.trim()}
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
        {hint && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {hint}
          </p>
        )}
      </form>
    </div>
  );
}

/** Floating disappearing chat, bottom right. */
export function ChatWidget({
  room,
  onClose,
  onEnded,
}: {
  room: StoredRoom;
  onClose: () => void;
  onEnded?: () => void;
}) {
  return (
    <section
      aria-label="Anonymous chat"
      className="release-glass fixed bottom-14 right-3 z-[45] flex h-[min(30rem,calc(100svh-6rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden sm:right-5"
    >
      <ChatThread room={room} onClose={onClose} onEnded={onEnded} />
    </section>
  );
}
