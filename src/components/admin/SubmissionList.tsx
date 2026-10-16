import { ChevronLeft, ChevronRight, MessageCircle, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { INTENTS, MOOD_LABELS } from "@/lib/dilkibaat";
import { PAGE_SIZE, STATUS_TONE, type AdminSubmissionRow } from "@/lib/admin";

const GRID =
  "lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)_8rem_8.5rem_6.5rem_6.5rem_4.5rem] lg:items-center lg:gap-4";

/** Page numbers with gaps: 1 … 4 5 6 … 12 */
function pageWindow(current: number, pages: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  for (let p = 0; p < pages; p++) {
    if (p === 0 || p === pages - 1 || Math.abs(p - current) <= 1) out.push(p);
    else if (out.at(-1) !== "gap") out.push("gap");
  }
  return out;
}

export function SubmissionList({
  rows,
  total,
  page,
  loading,
  fetching,
  error,
  filtered,
  newIds,
  onOpen,
  onPage,
  onRetry,
}: {
  rows: AdminSubmissionRow[] | undefined;
  total: number;
  page: number;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  filtered: boolean;
  newIds: Set<string>;
  onOpen: (id: string) => void;
  onPage: (page: number) => void;
  onRetry: () => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (error) {
    return (
      <div className="rounded-2xl glass-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to load submissions. Please try again.
        </p>
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        aria-hidden="true"
        className={`hidden px-5 font-mono text-[0.55rem] uppercase tracking-[0.22em] text-muted-foreground ${GRID}`}
      >
        <span>Date</span>
        <span>Nickname · words</span>
        <span>Category</span>
        <span>Request</span>
        <span>Mood</span>
        <span>Status</span>
        <span className="text-right">Featured</span>
      </div>

      <div
        className={`space-y-2 transition-opacity ${fetching && !loading ? "opacity-70" : ""}`}
        aria-busy={fetching}
      >
        {loading &&
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}

        {rows && rows.length === 0 && (
          <div className="rounded-2xl glass-panel p-10 text-center">
            <p className="font-display text-lg italic text-cream/80">
              {filtered ? "No submissions match your filters." : "No submissions found."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {filtered
                ? "Try widening the search or resetting filters."
                : "New confessions will appear here as they arrive."}
            </p>
          </div>
        )}

        {rows?.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpen(row.id)}
            className={`block w-full rounded-2xl glass-panel px-5 py-4 text-left text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${GRID}`}
          >
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {newIds.has(row.id) && (
                <span className="rounded-full bg-primary px-1.5 py-px font-mono text-[0.5rem] uppercase tracking-wider text-primary-foreground">
                  New
                </span>
              )}
              {new Date(row.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="mt-1 block min-w-0 lg:mt-0">
              <span className="flex items-center gap-1.5 text-cream/90">
                {row.nickname ?? row.alias}
                {row.chat_enabled && (
                  <MessageCircle className="size-3.5 text-primary" aria-label="Asked for chat" />
                )}
              </span>
              <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {row.content}
              </span>
            </span>
            <span className="mt-2 inline-block text-xs text-cream/80 lg:mt-0">
              {row.category ?? "Not asked"}
            </span>
            <span className="ml-3 text-xs text-cream/80 lg:ml-0">
              {row.intent
                ? (INTENTS.find((i) => i.value === row.intent)?.label ?? row.intent)
                : "Not asked"}
            </span>
            <span className="ml-3 text-xs text-cream/80 lg:ml-0">
              {row.emotional_state === null
                ? "Not asked"
                : `${row.emotional_state}/5 · ${MOOD_LABELS[row.emotional_state]}`}
            </span>
            <span className="mt-2 flex items-center gap-2 lg:mt-0">
              <Badge variant="outline" className={STATUS_TONE[row.status]}>
                {row.status}
              </Badge>
              {row.is_featured && (
                <Star
                  className="size-4 fill-primary text-primary lg:hidden"
                  aria-label="Featured"
                />
              )}
            </span>
            <span className="hidden text-right lg:block">
              {row.is_featured ? (
                <Star className="ml-auto size-4 fill-primary text-primary" aria-label="Featured" />
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {total > 0 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
          aria-label="Pagination"
        >
          <span>
            {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            {pageWindow(page, pages).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} className="px-1">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  size="sm"
                  variant={p === page ? "default" : "ghost"}
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => onPage(p)}
                  className="min-w-9"
                >
                  {p + 1}
                </Button>
              ),
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => onPage(page + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
