import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { SmoothScroll } from "@/components/SmoothScroll";
import { HelpModal } from "@/components/HelpModal";
import { AudioToggle } from "@/components/AudioToggle";
import { BackgroundFilm } from "@/components/BackgroundFilm";
import { SiteFooter } from "@/components/SiteFooter";
import { ReleaseForm } from "@/components/city/ReleaseForm";
import { ActiveChatView } from "@/components/city/ActiveChatView";
import {
  fetchWhispers,
  forgetRoom,
  latestLiveRoom,
  ROOMS_KEY,
  type StoredRoom,
} from "@/lib/confession";
import { subscribeToPush, type PushOptInStatus } from "@/lib/push-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dil Ki Baat · Sabke Sath | Say it without your name" },
      {
        name: "description",
        content:
          "Everybody looks fine from the outside. Walk through a city after midnight where every lit window holds something unsaid — then let go of your own, anonymously.",
      },
      { property: "og:title", content: "Dil Ki Baat · Sabke Sath" },
      {
        property: "og:description",
        content:
          "Behind every lit window is something unsaid. Read them, then release yours — no name, no account.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/dil-ki-baat-logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/dil-ki-baat-logo.png" },
    ],
  }),
  component: City,
});

/**
 * The page is one scene: the city film plays behind, the form is in front from
 * the very first paint (server-rendered, usable before the film has a frame).
 * Nothing waits on the video; if it cannot play, the poster stands in.
 */
function City() {
  // the ticker only ever shows real words: the visitor's own release, and
  // confessions their writers agreed to share that a mentor approved + featured
  const [mine, setMine] = useState<string[]>([]);
  // undefined means browser storage has not been checked yet. Never flash the
  // form over an existing anonymous room during hydration.
  const [room, setRoom] = useState<StoredRoom | null | undefined>(undefined);
  const [pushStatus, setPushStatus] = useState<PushOptInStatus | null>(null);

  const whispers = useQuery({
    queryKey: ["public-whispers"],
    queryFn: fetchWhispers,
    staleTime: 5 * 60_000,
  });
  const feed = [...mine, ...(whispers.data ?? []).map((w) => `“${w}”`)];

  // someone returning can reopen a chat that is still live (stored on this device only)
  useEffect(() => {
    setRoom((current) => current ?? latestLiveRoom());
    const syncRoom = (event: StorageEvent) => {
      if (event.key === ROOMS_KEY || event.key === null) setRoom(latestLiveRoom());
    };
    window.addEventListener("storage", syncRoom);
    // Reconcile an already granted browser subscription on a later visit.
    // This never prompts visitors who have not opted in.
    if ("Notification" in window && Notification.permission === "granted") {
      void subscribeToPush();
    }
    return () => window.removeEventListener("storage", syncRoom);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full">
        <SmoothScroll />
        <BackgroundFilm />

        {/* minimal floating chrome, on the same grid as the footer */}
        <header className="fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-background via-background/75 to-transparent px-6 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10 sm:pb-10 sm:pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/dil-ki-baat-logo.png"
                alt=""
                className="size-10 shrink-0 rounded-lg border border-primary/30 object-cover"
              />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="truncate font-display text-base tracking-tight text-cream">
                  Dil Ki Baat
                </span>
                <span className="mt-1 truncate font-mono text-[0.5rem] uppercase tracking-[0.26em] text-primary/70">
                  Sabke Sath · aapkamentor.ai
                </span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AudioToggle />
              <HelpModal />
            </div>
          </div>
        </header>

        {/* A live room owns this space. The form returns after it ends. */}
        <main
          id="release"
          aria-label={room ? "Your anonymous chat" : "Release your thought anonymously"}
          className="relative z-40 flex min-h-svh items-start justify-center px-4 pb-20 pt-24 sm:items-center sm:pt-28"
        >
          {room === undefined ? (
            <div
              className="release-glass mx-auto w-full max-w-2xl p-8 text-center text-sm text-muted-foreground"
              role="status"
            >
              Checking for your chat…
            </div>
          ) : room ? (
            <ActiveChatView
              room={room}
              pushStatus={pushStatus}
              onPushStatus={setPushStatus}
              onEnded={() => {
                forgetRoom(room.roomId);
                setRoom(latestLiveRoom());
              }}
            />
          ) : (
            <ReleaseForm
              onPushStatus={setPushStatus}
              onReleased={(text, newRoom) => {
                setMine((f) => [`You let go of: “${text.slice(0, 90)}”`, ...f].slice(0, 3));
                if (newRoom) setRoom(newRoom);
              }}
            />
          )}
        </main>

        <div className="relative z-40">
          <SiteFooter />
        </div>

        {/* whispers ticker: real, consented words only; absent when there are none */}
        <AnimatePresence>
          {feed.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.8, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-0 bottom-0 z-50 overflow-hidden border-t border-cream/10 bg-background/55 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md"
            >
              <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-14 whitespace-nowrap pl-6">
                {Array.from({ length: 2 * Math.max(1, Math.ceil(4 / feed.length)) }, () => feed)
                  .flat()
                  .map((line, i) => (
                    <span
                      key={i}
                      className="font-mono text-[0.62rem] tracking-wide text-muted-foreground"
                    >
                      {line}
                    </span>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
