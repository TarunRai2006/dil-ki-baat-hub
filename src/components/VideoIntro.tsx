import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { gsap } from "@/lib/gsap";
import { cityState } from "@/lib/city-state";

/**
 * The page's journey. The intro owns the first three states, the page the rest.
 *
 *   preparing -> poster on screen, film loading or waiting for a gesture
 *   playing   -> film running
 *   complete  -> film genuinely ended (or could not play); hand-off under way
 *   revealing -> form mounted and emerging while the film dissolves
 *   active    -> film gone, form interactive
 */
export type ExperienceState = "preparing" | "playing" | "complete" | "revealing" | "active";

/** What the <video> element itself is doing. */
type VideoState =
  | "initializing"
  | "loading"
  | "ready"
  | "playing"
  | "buffering"
  | "blocked"
  | "completed"
  | "error";

export const FILM = {
  src: "/media/intro.mp4",
  /** the film's exact first frame, so poster -> video is not a visible change */
  poster: "/media/intro-poster.webp",
  /** measured: the baked letterbox bars disappear on this frame */
  letterboxUntil: 4.875,
} as const;

/** City progress behind the film (same night street) and behind the form (crimson). */
export const CITY_HANDOFF = 0.78;
export const CITY_RELEASE = 0.9;

/** states with nothing moving on screen yet: quiet cues surface only if these drag on */
const WAITING: VideoState[] = ["initializing", "loading", "ready", "buffering"];

/** Dev-only switches for exercising every path: ?film=blocked|error|slow|end */
function debugMode(): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("film");
}

export function VideoIntro({
  stage,
  onStage,
}: {
  stage: ExperienceState;
  onStage: (stage: ExperienceState) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const finished = useRef(false);
  const holdMs = useRef(180);
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;

  const [video, setVideo] = useState<VideoState>("initializing");
  const [muted, setMuted] = useState(true);

  /**
   * The film is over, or cannot happen. Mount the form now, while the last
   * frame (or the poster) is held as a still, so any render cost is invisible;
   * the dissolve itself starts once that commit has landed (effect below).
   */
  const handOff = useCallback((reason: "ended" | "fallback") => {
    if (finished.current) return;
    finished.current = true;
    holdMs.current = reason === "ended" ? 180 : 600;
    if (stageRef.current) stageRef.current.style.pointerEvents = "none";
    onStageRef.current("complete");
    onStageRef.current("revealing");
  }, []);

  // The dissolve: a CSS opacity transition, which the compositor runs off the
  // main thread, so it stays smooth while the form mounts and the city wakes.
  useEffect(() => {
    if (stage !== "revealing") return;
    const el = stageRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 0 : holdMs.current;
    const fade = reduced ? 250 : 750;

    if (reduced) cityState.progress = CITY_RELEASE;
    else {
      // the live city keeps walking to the crimson street behind the form
      gsap.to(cityState, {
        progress: CITY_RELEASE,
        duration: 1.9,
        delay: hold / 1000,
        ease: "power2.inOut",
        overwrite: true,
      });
    }

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      const v = videoRef.current;
      if (v) {
        // free the decoder and the network connection
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      onStageRef.current("active");
    };
    if (!el) return finish();

    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "opacity") finish();
    };
    el.addEventListener("transitionend", onEnd);
    el.style.setProperty("--film-hold", `${hold}ms`);
    el.style.setProperty("--film-fade", `${fade}ms`);
    el.setAttribute("data-leaving", "");
    // only a safety net in case transitionend is swallowed (e.g. a hidden tab)
    const safety = window.setTimeout(finish, hold + fade + 400);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(safety);
    };
  }, [stage]);

  // The <video> is server-rendered (muted + autoplay), so the browser can start
  // fetching and playing before hydration. Catch up on whatever already
  // happened, then follow native media events. Strict-mode safe.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let alive = true;
    let debugTimer = 0;
    const mode = debugMode();

    const markReady = () => frameRef.current?.setAttribute("data-ready", "");
    const openFrame = () => {
      if (v.currentTime >= FILM.letterboxUntil) {
        frameRef.current?.setAttribute("data-open", "");
        v.removeEventListener("timeupdate", openFrame);
      }
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration)) {
        progressRef.current?.style.setProperty("--film-duration", `${v.duration}s`);
      }
      if (mode === "end") v.currentTime = Math.max(0, v.duration - 2);
    };
    const onLoadedData = () => {
      markReady();
      setVideo((s) => (s === "initializing" || s === "loading" ? "ready" : s));
    };
    const onPlaying = () => {
      markReady();
      // the film may have been playing before hydration, or just recovered from
      // a stall: line the CSS progress animation up with the real clock
      const anim = progressRef.current?.getAnimations?.()[0];
      if (anim) anim.currentTime = v.currentTime * 1000;
      setVideo("playing");
      if (!finished.current) onStageRef.current("playing");
    };
    const onWaiting = () => setVideo((s) => (s === "completed" || s === "error" ? s : "buffering"));
    const onEnded = () => {
      setVideo("completed");
      handOff("ended");
    };
    const onError = () => {
      if (!alive || finished.current) return;
      setVideo("error");
      handOff("fallback");
    };
    const play = () => {
      if (mode === "blocked") {
        setVideo("blocked");
        return;
      }
      // the returned promise is the only reliable signal that autoplay was refused
      v.play().catch((err: unknown) => {
        if (!alive || finished.current) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") setVideo("blocked");
        else if (name !== "AbortError") onError();
      });
    };

    v.muted = true;
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadeddata", onLoadedData);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("timeupdate", openFrame);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);

    if (mode === "blocked") {
      v.autoplay = false;
      v.pause();
      v.currentTime = 0;
    } else if (mode === "error") {
      v.src = "/media/__missing.mp4";
    } else if (mode === "slow") {
      v.pause();
      v.removeAttribute("src");
      v.load();
      setVideo("loading");
      debugTimer = window.setTimeout(() => {
        v.src = FILM.src;
        play();
      }, 6000);
    }

    // a cached film may already be ready, playing or even failed
    if (v.error) onError();
    else {
      if (v.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta();
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onLoadedData();
      else setVideo((s) => (s === "initializing" ? "loading" : s));
      openFrame();
      if (v.ended) onEnded();
      else if (!v.paused && v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onPlaying();
      else if (mode !== "slow" && mode !== "error") play();
    }

    return () => {
      alive = false;
      window.clearTimeout(debugTimer);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("loadeddata", onLoadedData);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("timeupdate", openFrame);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      // never leave a film (or its sound) running behind another page
      v.pause();
    };
  }, [handOff]);

  const begin = () => {
    const v = videoRef.current;
    if (!v) return;
    setVideo("loading");
    v.play().catch(() => handOff("fallback"));
  };

  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const waiting = WAITING.includes(video);
  const showChrome = video !== "blocked" && video !== "error";

  return (
    <div
      ref={stageRef}
      role="region"
      aria-label="Intro film"
      aria-busy={waiting}
      data-stage={stage}
      className="film-stage z-[70] select-none"
    >
      <p className="sr-only">
        A short film: a slow walk through a city at night, where the unsaid thoughts of strangers
        glow beside lit windows. The form to write your own follows when it ends.
      </p>

      {/* 0 — the picture: poster underneath, the film on top once it has a frame */}
      <div ref={frameRef} className="film-frame">
        <img
          src={FILM.poster}
          alt=""
          aria-hidden="true"
          width={1280}
          height={720}
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
        <video
          ref={videoRef}
          src={FILM.src}
          muted
          autoPlay
          playsInline
          webkit-playsinline=""
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
        />
        <span aria-hidden="true" className="film-bar" data-edge="top" />
        <span aria-hidden="true" className="film-bar" data-edge="bottom" />
      </div>

      {/* 1 — a quiet grade: depth at the edges, legibility under the controls */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_60%,rgb(0_0_0/38%)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/45 to-transparent"
      />

      {/* 2 — minimal chrome, inside the safe area */}
      {showChrome && (
        <div
          data-chrome
          className="pointer-events-none fixed inset-0 flex flex-col justify-between pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:pb-[max(2rem,env(safe-area-inset-bottom))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pt-[max(1.75rem,env(safe-area-inset-top))]"
        >
          <p className="text-center font-mono text-[0.55rem] uppercase tracking-[0.44em] text-cream/55">
            Dil Ki Baat · Sabke Sath
          </p>
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="relative h-px flex-1 overflow-hidden bg-cream/10">
              <span
                ref={progressRef}
                data-run={video === "playing" ? "" : undefined}
                className="film-progress absolute inset-0 bg-cream/55"
              />
            </span>
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={!muted}
              aria-label={muted ? "Turn film sound on" : "Turn film sound off"}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-cream/20 bg-black/25 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-cream/75 transition-colors duration-300 hover:border-cream/50 hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              <span className="hidden sm:inline">{muted ? "Sound off" : "Sound on"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 — only if something needs the visitor: a gesture, or a very slow network */}
      <div data-chrome aria-live="polite" className="pointer-events-none fixed inset-0">
        {video === "blocked" && (
          <div className="flex h-full items-center justify-center">
            <button
              type="button"
              onClick={begin}
              className="film-cue group pointer-events-auto flex flex-col items-center gap-4 outline-none"
              style={{ ["--cue-delay" as string]: "0ms" }}
            >
              <span className="grid size-16 place-items-center rounded-full border border-cream/40 bg-black/25 text-cream transition-colors duration-300 group-hover:border-cream group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
              </span>
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.36em] text-cream/80">
                Play the film
              </span>
            </button>
          </div>
        )}

        {waiting && (
          <div
            key={video}
            className="absolute inset-x-0 bottom-[22%] flex flex-col items-center gap-5"
          >
            <span className="sr-only">Loading the film</span>
            <span aria-hidden="true" className="film-cue hairline w-32" />
            <button
              type="button"
              onClick={() => handOff("fallback")}
              className="film-cue pointer-events-auto font-mono text-[0.55rem] uppercase tracking-[0.3em] text-cream/55 underline-offset-4 transition-colors hover:text-cream hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ ["--cue-delay" as string]: "8000ms" }}
            >
              Continue without the film
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
