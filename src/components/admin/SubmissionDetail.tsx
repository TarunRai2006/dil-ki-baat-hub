import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, MessageCircle, Star, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  describeLog,
  describePatch,
  fetchModerationLog,
  fetchSubmission,
  STATUS_TONE,
  updateSubmission,
  type AdminSubmission,
  type AdminSubmissionRow,
  type SubmissionPatch,
} from "@/lib/admin";
import {
  CONFESSION_STATUSES,
  NOTES_MAX,
  friendlyError,
  type ConfessionStatus,
} from "@/lib/confession";
import { INTENTS, MOOD_LABELS, TTL_OPTIONS } from "@/lib/dilkibaat";

type Confirm = { title: string; body: string; action: string; patch: SubmissionPatch } | null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-3 border-b border-cream/5 py-2 text-sm last:border-b-0">
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-cream/90">{children}</dd>
    </div>
  );
}

/** The full confession and every moderation control, in a right-side sheet. */
export function SubmissionDetail({
  id,
  onOpenChange,
  onOpenChat,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenChat: (roomId: string) => void;
}) {
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["submission", id],
    enabled: !!id,
    queryFn: () => fetchSubmission(id!),
  });
  const { data: log = [] } = useQuery({
    queryKey: ["moderation-log", id],
    enabled: !!id,
    queryFn: () => fetchModerationLog(id!),
  });

  // Notes draft vs. the database. Another mentor (or tab) may save notes while
  // this one is typing: never overwrite an unsaved draft, flag the conflict.
  const [notes, setNotes] = useState("");
  const [notesConflict, setNotesConflict] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const notesBase = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!s) return;
    const server = s.admin_notes ?? "";
    const base = notesBase.current;
    const untouched = !base || base.id !== s.id || notesRef.current === base.text;
    if (untouched || server === notesRef.current) {
      notesBase.current = { id: s.id, text: server };
      setNotes(server);
      setNotesConflict(false);
    } else if (server !== base.text) {
      setNotesConflict(true);
    }
  }, [s]);
  const [confirm, setConfirm] = useState<Confirm>(null);

  type ListPage = { rows: AdminSubmissionRow[]; total: number };
  const mutation = useMutation({
    mutationFn: (patch: SubmissionPatch) => updateSubmission(id!, patch),
    // optimistic: the panel and the list change at once, and roll back if the
    // database refuses (the server stays the only source of truth)
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["submission", id] });
      await qc.cancelQueries({ queryKey: ["submissions"] });
      const detail = qc.getQueryData<AdminSubmission>(["submission", id]);
      const lists = qc.getQueriesData<ListPage>({ queryKey: ["submissions"] });
      const apply = <T extends AdminSubmissionRow>(row: T): T => ({
        ...row,
        ...(patch.status && { status: patch.status }),
        ...(patch.is_featured !== undefined && { is_featured: patch.is_featured }),
        ...(patch.is_archived !== undefined && { is_archived: patch.is_archived }),
        ...(patch.deleted !== undefined && {
          deleted_at: patch.deleted ? new Date().toISOString() : null,
        }),
      });
      if (detail) {
        qc.setQueryData<AdminSubmission>(["submission", id], {
          ...apply(detail),
          ...(patch.admin_notes !== undefined && { admin_notes: patch.admin_notes || null }),
        });
      }
      qc.setQueriesData<ListPage>({ queryKey: ["submissions"] }, (page) =>
        page ? { ...page, rows: page.rows.map((r) => (r.id === id ? apply(r) : r)) } : page,
      );
      return { detail, lists };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.detail) qc.setQueryData(["submission", id], ctx.detail);
      ctx?.lists.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(friendlyError(err, "Failed to update. Your change was not saved."));
    },
    onSuccess: (row, patch) => {
      qc.setQueryData(["submission", id], row);
      toast.success(describePatch(patch));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["submissions"] });
      void qc.invalidateQueries({ queryKey: ["admin-stats"] });
      void qc.invalidateQueries({ queryKey: ["moderation-log", id] });
    },
  });
  const busy = mutation.isPending;
  const setStatus = (status: ConfessionStatus) => mutation.mutate({ status });
  const notesDirty = (notesBase.current?.text ?? s?.admin_notes ?? "") !== notes;
  const takeServerNotes = () => {
    const server = s?.admin_notes ?? "";
    notesBase.current = s ? { id: s.id, text: server } : null;
    setNotes(server);
    setNotesConflict(false);
  };

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto border-border bg-background/95 p-0 backdrop-blur-xl sm:max-w-xl"
      >
        <SheetHeader className="border-b border-cream/10 px-6 py-5 text-left">
          <SheetTitle className="font-display text-2xl text-gradient-gold">
            {s ? (s.nickname ?? s.alias) : "Submission"}
          </SheetTitle>
          <SheetDescription className="font-mono text-[0.6rem] uppercase tracking-[0.22em]">
            {s ? `${s.alias} · ${new Date(s.created_at).toLocaleString()}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3 p-6">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}

        {isError && (
          <div className="p-6 text-sm text-muted-foreground">
            Unable to load this submission. Please try again.
            <Button variant="secondary" size="sm" className="ml-3" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        {s && (
          <div className="space-y-7 px-6 py-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={STATUS_TONE[s.status]}>
                {s.status}
              </Badge>
              {s.is_featured && (
                <Badge variant="outline" className="border-primary/50 text-primary">
                  <Star className="mr-1 size-3 fill-primary" aria-hidden="true" /> Featured
                </Badge>
              )}
              {s.is_archived && <Badge variant="secondary">Archived</Badge>}
              {s.deleted_at && <Badge variant="destructive">In trash</Badge>}
            </div>

            <dl>
              <Row label="Date">{new Date(s.created_at).toLocaleString()}</Row>
              <Row label="Category">{s.category}</Row>
              <Row label="Type">{INTENTS.find((i) => i.value === s.intent)?.label ?? s.intent}</Row>
              <Row label="Emotional state">
                {s.emotional_state}/5 · {MOOD_LABELS[s.emotional_state] ?? "—"}
              </Row>
              <Row label="Nickname">
                {s.nickname ?? <span className="text-muted-foreground">None</span>}
              </Row>
              <Row label="Instagram">{s.highlight_on_instagram}</Row>
              <Row label="Live chat">
                {s.chat_enabled
                  ? (TTL_OPTIONS.find((t) => t.value === s.chat_ttl)?.label ?? s.chat_ttl)
                  : "Not requested"}
              </Row>
              {s.reviewed_at && (
                <Row label="Last reviewed">{new Date(s.reviewed_at).toLocaleString()}</Row>
              )}
            </dl>

            <section>
              <h3 className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-primary/80">
                Confession
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words rounded-2xl border border-cream/10 bg-cream/[0.03] p-4 text-[0.95rem] leading-relaxed text-cream">
                {s.content}
              </p>
            </section>

            <section>
              <h3 className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-primary/80">
                Community question
              </h3>
              <p className="mt-2 text-sm italic text-cream/85">
                {s.community_question ?? (
                  <span className="not-italic text-muted-foreground">None asked</span>
                )}
              </p>
            </section>

            <section>
              <h3 className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-primary/80">
                Status
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {CONFESSION_STATUSES.map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={s.status === st ? "default" : "secondary"}
                    disabled={busy || s.status === st}
                    onClick={() => setStatus(st)}
                    aria-pressed={s.status === st}
                  >
                    {st === "Pending"
                      ? "Back to pending"
                      : st === "Reviewed"
                        ? "Mark reviewed"
                        : st === "Approved"
                          ? "Approve"
                          : "Reject"}
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={busy}
                  onClick={() => mutation.mutate({ is_featured: !s.is_featured })}
                >
                  <Star
                    className={`size-4 ${s.is_featured ? "fill-primary text-primary" : ""}`}
                    aria-hidden="true"
                  />
                  {s.is_featured ? "Unfeature" : "Feature"}
                </Button>
                {s.is_archived ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={busy}
                    onClick={() => mutation.mutate({ is_archived: false })}
                  >
                    <ArchiveRestore className="size-4" aria-hidden="true" /> Restore from archive
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: "Archive this confession?",
                        body: "It leaves the active queue and any live chat for it is closed. You can restore it from the Archived view.",
                        action: "Archive",
                        patch: { is_archived: true },
                      })
                    }
                  >
                    <Archive className="size-4" aria-hidden="true" /> Archive
                  </Button>
                )}
                {s.deleted_at ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={busy}
                    onClick={() => mutation.mutate({ deleted: false })}
                  >
                    <Undo2 className="size-4" aria-hidden="true" /> Restore from trash
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2 text-red-200 hover:text-red-100"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: "Move to trash?",
                        body: "Nothing is destroyed: the confession is hidden from every queue and can be restored from Trash.",
                        action: "Move to trash",
                        patch: { deleted: true },
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Move to trash
                  </Button>
                )}
                {s.chat_enabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2"
                    onClick={() => onOpenChat(s.id)}
                  >
                    <MessageCircle className="size-4" aria-hidden="true" /> Open chat
                  </Button>
                )}
              </div>
            </section>

            <section>
              <label
                htmlFor="admin-notes"
                className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-primary/80"
              >
                Admin notes
              </label>
              <Textarea
                id="admin-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={NOTES_MAX}
                rows={4}
                placeholder="Private to mentors. Never shown to the writer."
                className="mt-2 border-cream/12 bg-background/40 text-sm"
              />
              {notesConflict && (
                <p
                  role="status"
                  className="mt-2 rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-cream/90"
                >
                  Another mentor changed these notes while you were editing. Saving will replace
                  their version with yours.{" "}
                  <button type="button" className="underline" onClick={takeServerNotes}>
                    Use their version
                  </button>
                </p>
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                {notesDirty && (
                  <Button size="sm" variant="ghost" onClick={takeServerNotes} disabled={busy}>
                    Discard
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={busy || !notesDirty}
                  onClick={() => mutation.mutate({ admin_notes: notes })}
                >
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  Save notes
                </Button>
              </div>
            </section>

            {log.length > 0 && (
              <section>
                <h3 className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-primary/80">
                  History
                </h3>
                <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {log.map((l) => (
                    <li key={l.id}>
                      <span className="text-cream/70">
                        {new Date(l.created_at).toLocaleString()}
                      </span>{" "}
                      · {describeLog(l)}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
          <AlertDialogContent className="glass-panel">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirm) mutation.mutate(confirm.patch);
                  setConfirm(null);
                }}
              >
                {confirm?.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
