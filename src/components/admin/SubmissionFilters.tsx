import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, INTENTS, MOOD_LABELS } from "@/lib/dilkibaat";
import { CONFESSION_STATUSES, type ConfessionStatus } from "@/lib/confession";
import type { SubmissionFilters as Filters, SubmissionSort, SubmissionView } from "@/lib/admin";

function Pick({
  label,
  value,
  onChange,
  options,
  width = "w-40",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  width?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every filter maps to a WHERE clause; nothing is filtered in the browser. */
export function SubmissionFilters({
  filters,
  searchInput,
  onSearch,
  onChange,
  onReset,
}: {
  filters: Filters;
  searchInput: string;
  onSearch: (v: string) => void;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl glass-panel p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search words, nicknames, categories, questions…"
            className="pl-9"
            aria-label="Search submissions"
          />
        </div>
        <Pick
          label="Queue"
          value={filters.view}
          onChange={(v) => onChange({ view: v as SubmissionView })}
          width="w-32"
          options={[
            ["active", "Active"],
            ["archived", "Archived"],
            ["trash", "Trash"],
          ]}
        />
        <Pick
          label="Status"
          value={filters.status}
          onChange={(v) => onChange({ status: v as ConfessionStatus | "all" })}
          options={[
            ["all", "All statuses"],
            ...CONFESSION_STATUSES.map((s): [string, string] => [s, s]),
          ]}
        />
        <Pick
          label="Category"
          value={filters.category}
          onChange={(v) => onChange({ category: v })}
          width="w-44"
          options={[["all", "All categories"], ...CATEGORIES.map((c): [string, string] => [c, c])]}
        />
        <Pick
          label="Request type"
          value={filters.intent}
          onChange={(v) => onChange({ intent: v })}
          width="w-44"
          options={[
            ["all", "Any request"],
            ...INTENTS.map((i): [string, string] => [i.value, i.label]),
          ]}
        />
        <Pick
          label="Emotional state"
          value={filters.mood === null ? "all" : String(filters.mood)}
          onChange={(v) => onChange({ mood: v === "all" ? null : Number(v) })}
          options={[
            ["all", "Any mood"],
            ...[1, 2, 3, 4, 5].map((m): [string, string] => [
              String(m),
              `${m} · ${MOOD_LABELS[m]}`,
            ]),
          ]}
        />
        <Pick
          label="Sort"
          value={filters.sort}
          onChange={(v) => onChange({ sort: v as SubmissionSort })}
          options={[
            ["newest", "Newest first"],
            ["oldest", "Oldest first"],
            ["updated", "Recently updated"],
          ]}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          From
          <Input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => onChange({ from: e.target.value })}
            className="h-9 w-40"
          />
        </label>
        <label className="flex items-center gap-2">
          To
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => onChange({ to: e.target.value })}
            className="h-9 w-40"
          />
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={filters.featured} onCheckedChange={(v) => onChange({ featured: v })} />
          Featured only
        </label>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset filters
        </Button>
      </div>
    </div>
  );
}
