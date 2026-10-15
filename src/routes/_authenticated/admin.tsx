import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminStats } from "@/components/admin/AdminStats";
import { SubmissionFilters } from "@/components/admin/SubmissionFilters";
import { SubmissionList } from "@/components/admin/SubmissionList";
import { SubmissionDetail } from "@/components/admin/SubmissionDetail";
import { AdminChat } from "@/components/admin/AdminChat";
import { PushNotifications } from "@/components/admin/PushNotifications";
import {
  DEFAULT_FILTERS,
  adminSession,
  fetchRooms,
  fetchStats,
  fetchSubmissions,
  isUnread,
  loadSeen,
  saveSeen,
  type SeenMap,
  type SubmissionFilters as Filters,
} from "@/lib/admin";

export const Route = createFileRoute("/_authenticated/admin")({
  // Router-level gate. The parent route has already verified the session with
  // the auth server; here the database says whether this user is an admin.
  // (The database also refuses every admin read/write on its own.)
  beforeLoad: async () => {
    const { data, error } = await supabase.rpc("is_admin");
    return { isAdmin: data === true, accessError: !!error };
  },
  head: () => ({
    meta: [
      { title: "Counsellor & Therapist Dashboard | Dil Ki Baat" },
      {
        name: "description",
        content: "Review anonymous submissions and reply to private live chats.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
  // a crash inside the dashboard stays inside the dashboard, with a way back
  errorComponent: AdminError,
});

function AdminError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md px-5 py-24 text-center">
      <h1 className="font-display text-3xl text-primary">The dashboard hit a problem</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Nothing was changed. Reload the dashboard to continue.
      </p>
      <Button
        className="mt-6"
        variant="secondary"
        onClick={() => {
          void router.invalidate();
          reset();
        }}
      >
        Reload dashboard
      </Button>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function AdminPage() {
  const { isAdmin, accessError } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState("submissions");
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [seen, setSeen] = useState<SeenMap>({});
  useEffect(() => setSeen(loadSeen()), []);
  const markSeen = useCallback((roomId: string, at: string) => {
    setSeen((prev) => {
      const next = { ...prev, [roomId]: at };
      saveSeen(next);
      return next;
    });
  }, []);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [live, setLive] = useState(true);

  const query = { ...filters, search };
  // without a live realtime connection, fall back to a gentle refresh
  const refetchInterval = live ? false : 30_000;
  const list = useQuery({
    queryKey: ["submissions", query],
    enabled: isAdmin,
    queryFn: () => fetchSubmissions(query),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
  // same cache entry the Chats tab reads, so the badge costs no extra request there
  const liveRooms = useQuery({
    queryKey: ["chat-rooms", "live"],
    enabled: isAdmin,
    queryFn: () => fetchRooms("live"),
    refetchInterval,
  });
  const unreadRooms = (liveRooms.data ?? []).filter((r) => isUnread(r, seen)).length;
  const stats = useQuery({
    queryKey: ["admin-stats"],
    enabled: isAdmin,
    queryFn: fetchStats,
    refetchInterval,
  });

  // new or changed confessions appear without a refresh, including other admins' edits
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("admin-submissions")
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions" }, (payload) => {
        void qc.invalidateQueries({ queryKey: ["submissions"] });
        void qc.invalidateQueries({ queryKey: ["admin-stats"] });
        const id = (payload.new as { id?: string } | null)?.id;
        if (id) void qc.invalidateQueries({ queryKey: ["submission", id] });
        if (id) void qc.invalidateQueries({ queryKey: ["moderation-log", id] });
        if (payload.eventType === "INSERT" && id) {
          setNewIds((s) => new Set(s).add(id));
          toast("New confession received");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          setLive(false);
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, qc]);

  // room list and the Chats badge follow room activity (a new message bumps last_message_at)
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("admin-chat-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        void qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, qc]);

  const change = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  useEffect(() => setFilters((f) => ({ ...f, page: 0 })), [search]);

  const signOut = async () => {
    adminSession.leaving = true;
    await supabase.auth.signOut();
    qc.clear();
    await navigate({ to: "/auth" });
  };

  if (accessError) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to verify your access. Please try again.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void router.invalidate()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-3xl text-primary">
          Counsellor or therapist access required
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account is signed in but doesn&apos;t have the admin role yet. Ask a Dil Ki Baat
          owner to grant it.
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  const filtered =
    !!search.trim() ||
    JSON.stringify({ ...filters, page: 0 }) !== JSON.stringify({ ...DEFAULT_FILTERS });

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-gradient-gold">
            Counsellor &amp; Therapist Dashboard
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            Dil Ki Baat · aapkamentor.ai
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.58rem] uppercase tracking-[0.2em]">
              <span
                className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-ember animate-pulse"}`}
                aria-hidden="true"
              />
              {live ? "Live" : "Refreshing every 30s"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {newIds.size > 0 && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setTab("submissions");
                setSearchInput("");
                setFilters(DEFAULT_FILTERS);
              }}
            >
              <Sparkles className="size-4" /> {newIds.size} new
            </Button>
          )}
          <Button variant="secondary" className="gap-2" onClick={() => void signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mt-8">
        <AdminStats
          stats={stats.data}
          loading={stats.isLoading}
          error={stats.isError}
          onRetry={() => void stats.refetch()}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="push">
            <span className="sm:hidden">Push</span>
            <span className="hidden sm:inline">Push Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="chats" className="gap-2">
            Chats
            {(liveRooms.data?.length ?? 0) > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 text-[0.65rem] text-primary">
                {liveRooms.data!.length} live
              </span>
            )}
            {unreadRooms > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[0.65rem] text-primary-foreground">
                {unreadRooms} unread
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4 space-y-4">
          <SubmissionFilters
            filters={filters}
            searchInput={searchInput}
            onSearch={setSearchInput}
            onChange={change}
            onReset={() => {
              setSearchInput("");
              setFilters(DEFAULT_FILTERS);
            }}
          />
          <SubmissionList
            rows={list.data?.rows}
            total={list.data?.total ?? 0}
            page={filters.page}
            loading={list.isLoading}
            fetching={list.isFetching}
            error={list.isError}
            filtered={filtered}
            newIds={newIds}
            onOpen={(id) => {
              setOpenId(id);
              setNewIds((s) => {
                if (!s.has(id)) return s;
                const next = new Set(s);
                next.delete(id);
                return next;
              });
            }}
            onPage={(page) => setFilters((f) => ({ ...f, page }))}
            onRetry={() => void list.refetch()}
          />
        </TabsContent>

        <TabsContent value="chats" className="mt-4">
          <AdminChat
            activeRoom={activeRoom}
            onSelectRoom={setActiveRoom}
            onOpenSubmission={setOpenId}
            seen={seen}
            onSeen={markSeen}
          />
        </TabsContent>
        <TabsContent value="push" className="mt-4">
          <PushNotifications />
        </TabsContent>
      </Tabs>

      <SubmissionDetail
        id={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
        onOpenChat={(roomId) => {
          setOpenId(null);
          setActiveRoom(roomId);
          setTab("chats");
        }}
      />
    </div>
  );
}
