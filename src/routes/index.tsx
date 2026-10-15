import { useEffect, useLayoutEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { SmoothScroll } from "@/components/SmoothScroll";
import { HelpModal } from "@/components/HelpModal";
import { AudioToggle } from "@/components/AudioToggle";
import { BackgroundFilm } from "@/components/BackgroundFilm";
import { SiteFooter } from "@/components/SiteFooter";
import { FooterConfessionsCarousel } from "@/components/FooterConfessionsCarousel";
import { ReleaseForm } from "@/components/city/ReleaseForm";
import { ActiveChatView } from "@/components/city/ActiveChatView";
import { WhispersMarquee } from "@/components/WhispersMarquee";
import { forgetRoom, latestLiveRoom, ROOMS_KEY, type StoredRoom } from "@/lib/confession";
import { installPushPromptOnFirstInteraction, subscribeToPush } from "@/lib/push-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dil Ki Baat · Sabke Sath | Say it without your name" },
      {
        name: "description",
        content:
          "Share what is on your mind without an account or real name. A verified counsellor or therapist may respond in a private chat you can reopen in this browser.",
      },
      { property: "og:title", content: "Dil Ki Baat · Sabke Sath" },
      {
        property: "og:description",
        content:
          "Share your story without an account or real name, then return to your private chat in this browser.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/dil-ki-baat-mark.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/dil-ki-baat-mark.png" },
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
  const [room, setRoom] = useState<StoredRoom | null>(null);
  const [storageChecked, setStorageChecked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeIntent, setWelcomeIntent] = useState<"Advice" | "Express" | null>(null);

  // someone returning can reopen a chat that is still live (stored on this device only)
  useLayoutEffect(() => {
    setRoom(latestLiveRoom());
    setStorageChecked(true);
    const syncRoom = (event: StorageEvent) => {
      if (event.key === ROOMS_KEY || event.key === null) setRoom(latestLiveRoom());
    };
    window.addEventListener("storage", syncRoom);
    return () => window.removeEventListener("storage", syncRoom);
  }, []);

  // A tiny pre-hydration check hides the server-rendered form only for a
  // returning visitor. Reveal this space after React restores their chat.
  useLayoutEffect(() => {
    if (storageChecked) document.documentElement.removeAttribute("data-room-pending");
  }, [storageChecked]);

  useEffect(() => {
    // Reconcile an already granted browser subscription on a later visit.
    // This never prompts visitors who have not opted in.
    if ("Notification" in window && Notification.permission === "granted") {
      void subscribeToPush();
    }
    const removePushPrompt = installPushPromptOnFirstInteraction();
    return () => {
      removePushPrompt();
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full">
        <SmoothScroll />
        <BackgroundFilm />

        <header className="fixed inset-x-0 top-0 z-50 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link
              to="/"
              className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <img
                src="/dil-ki-baat-mark.png"
                alt="Dil Ki Baat Haven logo"
                className="size-10 shrink-0 rounded-lg border border-primary/30 object-contain sm:size-11"
              />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="truncate font-display text-base tracking-tight text-cream">
                  Dil Ki Baat
                </span>
                <span className="mt-1 truncate font-mono text-[0.5rem] uppercase tracking-[0.26em] text-primary/70">
                  Sabke Sath<span className="hidden sm:inline"> · aapkamentor.ai</span>
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <AudioToggle />
              <HelpModal />
            </div>
          </div>
        </header>
        <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-30 sm:top-[calc(4.25rem+env(safe-area-inset-top))]">
          <WhispersMarquee />
        </div>

        {/* A live room owns this space. The form returns after it ends. */}
        <main
          id="release"
          aria-label={room ? "Your private chat" : "Share your story anonymously"}
          className="relative z-40 flex min-h-svh items-start justify-center px-4 pb-20 pt-32 sm:items-center sm:pt-36"
        >
          {room ? (
            <ActiveChatView
              room={room}
              showWelcome={showWelcome}
              welcomeIntent={welcomeIntent}
              onCloseWelcome={() => setShowWelcome(false)}
              onEnded={() => {
                forgetRoom(room.roomId);
                setRoom(latestLiveRoom());
              }}
            />
          ) : (
            <ReleaseForm
              onReleased={(_text, newRoom, intent) => {
                if (newRoom) {
                  setRoom(newRoom);
                  setWelcomeIntent(intent);
                  setShowWelcome(true);
                }
              }}
            />
          )}
        </main>

        <div className="relative z-40">
          <SiteFooter />
          <FooterConfessionsCarousel />
        </div>
      </div>
    </MotionConfig>
  );
}
