import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MOOD_LABELS } from "@/lib/dilkibaat";
import type { DashboardStats } from "@/lib/admin";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
};

function Tile({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | string | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl glass-panel px-4 py-3.5">
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className="mt-1 font-display text-3xl text-primary">{value ?? "—"}</p>
      )}
    </div>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
  loading,
  empty,
}: {
  title: string;
  data: Record<string, string | number>[];
  dataKey: string;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <section className="rounded-2xl glass-panel p-5">
      <h2 className="font-display text-lg text-primary">{title}</h2>
      <div className="mt-3 h-52">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : empty ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey={dataKey} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                width={28}
              />
              <RTooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              />
              <Bar dataKey="count" fill="var(--gold)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

/** Overview numbers and distributions, all aggregated by the database. */
export function AdminStats({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: DashboardStats | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="rounded-2xl glass-panel p-6 text-sm text-muted-foreground">
        Unable to load the overview. Please try again.
        <Button size="sm" variant="secondary" className="ml-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  const s = stats;
  const tiles: [string, number | string | undefined][] = [
    ["Total", s?.total],
    ["Today", s?.today],
    ["This week", s?.week],
    ["Pending", s?.pending],
    ["Reviewed", s?.reviewed],
    ["Approved", s?.approved],
    ["Rejected", s?.rejected],
    ["Archived", s?.archived],
    ["Featured", s?.featured],
    ["Live chats", s?.live_chats],
    ["Pulse index", s?.pulse ?? "—"],
  ];
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <Tile key={label} label={label} value={value} loading={loading} />
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Where it hurts"
          data={s?.categories ?? []}
          dataKey="name"
          loading={loading}
          empty={!s?.categories.length}
        />
        <ChartCard
          title="How heavy today is"
          data={(s?.moods ?? []).map((m) => ({
            label: `${m.mood} · ${MOOD_LABELS[m.mood]}`,
            count: m.count,
          }))}
          dataKey="label"
          loading={loading}
          empty={!s?.total}
        />
      </div>
    </div>
  );
}
