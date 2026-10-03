import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { Canvas } from "@react-three/fiber";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Heart, MessageCircle } from "lucide-react";
import { SmoothScroll } from "@/components/SmoothScroll";
import { HelpModal } from "@/components/HelpModal";
import { AudioToggle } from "@/components/AudioToggle";
import { VideoIntro, CITY_HANDOFF, type ExperienceState } from "@/components/VideoIntro";
import { SiteFooter } from "@/components/SiteFooter";
import { ReleaseForm } from "@/components/city/ReleaseForm";
import { ChatWidget } from "@/components/ChatWidget";
import { forgetRoom, latestLiveRoom, type StoredRoom } from "@/lib/confession";
import { cityState } from "@/lib/city-state";
import { scrollControls } from "@/lib/scroll-state";
import { fetchWhispers } from "@/lib/confession";

const CityScene = lazy(() => import("@/components/city/CityScene"));

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
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: City,
});

/** Publishes the pointer into the shared city state for the scene's parallax. */
function useCityPointer() {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      cityState.px = (e.clientX / window.innerWidth) * 2 - 1;
      cityState.py = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
}

/**
 * Holds the page still while the film plays: pauses Lenis rather than fighting
 * it, and stops overflow and rubber-banding (iOS) on the document. Restored the
 * moment the form arrives, and on unmount, so the page can never stay locked.
 */
function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow, html.style.overscrollBehavior];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    scrollControls.stop();
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
      html.style.overscrollBehavior = prev[2];
      scrollControls.start();
    };
  }, [locked]);
}

function City() {
  useCityPointer();
  const [stage, setStage] = useState<ExperienceState>("preparing");
  // the ticker only ever shows real words: the visitor's own release, and
  // confessions their writers agreed to share that a mentor approved + featured
  const [mine, setMine] = useState<string[]>([]);
  const [room, setRoom] = useState<StoredRoom | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const filming = stage === "preparing" || stage === "playing";
  const revealed = stage === "revealing" || stage === "active";
  const whispers = useQuery({
    queryKey: ["public-whispers"],
    queryFn: fetchWhispers,
    enabled: revealed,
    staleTime: 5 * 60_000,
  });
  const feed = [...mine, ...(whispers.data ?? []).map((w) => `“${w}”`)];
  useScrollLock(!revealed);

  // the live city waits on the same street the film walks down
  useEffect(() => {
    cityState.progress = CITY_HANDOFF;
  }, []);

  // once the form is fully interactive, give keyboard and screen-reader focus
  // to it (no scroll jump); someone returning can also reopen a live chat
  useEffect(() => {
    if (stage === "revealing") window.scrollTo(0, 0);
    if (stage !== "active") return;
    document.getElementById("release")?.focus({ preventScroll: true });
    setRoom((current) => current ?? latestLiveRoom());
  }, [stage]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full">
        <SmoothScroll />

        {/* the living city: one fixed WebGL canvas, idle behind the film, alive behind the form */}
        <div className="fixed inset-0 z-0 h-screen w-full bg-[#07090e]">
          <ClientOnly fallback={null}>
            <Suspense fallback={null}>
              <Canvas
                frameloop={filming ? "demand" : "always"}
                dpr={[1, 1.6]}
                camera={{ fov: 58, near: 0.1, far: 620, position: [0, 52, 46] }}
                gl={{ antialias: true, powerPreference: "high-performance" }}
              >
                <CityScene />
              </Canvas>
            </Suspense>
          </ClientOnly>
          {/* vignette keeps overlay typography legible over the skyline */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(78%_62%_at_50%_46%,transparent_0%,rgb(0_0_0/72%)_100%)]"
          />
        </div>

        {/* the film: server-rendered so its poster paints with the HTML; plays once, then dissolves */}
        {stage !== "active" && <VideoIntro stage={stage} onStage={setStage} />}

        {/* minimal floating chrome, on the same grid as the footer */}
        <motion.header
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : -14 }}
          transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-background via-background/75 to-transparent px-6 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10 sm:pb-10 sm:pt-[max(1.5rem,env(safe-area-inset-top))] ${revealed ? "" : "pointer-events-none"}`}
          aria-hidden={!revealed}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-full border border-primary/30">
                <Heart className="size-3.5 fill-primary/70 text-primary" />
              </span>
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
        </motion.header>

        {revealed && (
          <>
            {/* the release form: the next scene of the film, not a section to scroll to */}
            <main
              id="release"
              tabIndex={-1}
              inert={stage !== "active"}
              aria-label="Release your thought anonymously"
              className="relative z-40 flex min-h-svh items-start justify-center px-4 pb-28 pt-24 outline-none sm:items-center sm:pt-28"
            >
              <ReleaseForm
                onReleased={(text, newRoom) => {
                  setMine((f) => [`You let go of: “${text.slice(0, 90)}”`, ...f].slice(0, 3));
                  if (newRoom) {
                    setRoom(newRoom);
                    setChatOpen(true);
                  }
                }}
              />
            </main>

            <div className="relative z-40">
              <SiteFooter />
            </div>
          </>
        )}

        {/* the anonymous chat, or a way back to it */}
        {revealed && room && chatOpen && (
          <ChatWidget
            room={room}
            onClose={() => setChatOpen(false)}
            onEnded={() => {
              forgetRoom(room.roomId);
              setRoom(null);
              setChatOpen(false);
            }}
          />
        )}
        {revealed && room && !chatOpen && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="fixed bottom-14 right-3 z-[60] inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/70 px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-primary shadow-lg backdrop-blur-md transition-colors hover:border-primary hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-5"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Your chat
          </button>
        )}

        {/* whispers ticker: real, consented words only; absent when there are none */}
        <AnimatePresence>
          {revealed && feed.length > 0 && (
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
