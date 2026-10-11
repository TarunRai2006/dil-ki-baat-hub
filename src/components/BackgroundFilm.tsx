import { useEffect, useRef } from "react";

export const FILM = {
  src: "/media/intro.mp4",
  /** the film's exact first frame, so poster -> video is not a visible change */
  poster: "/media/intro-poster.webp",
} as const;

/** Dev-only switches for exercising the fallbacks: ?film=blocked|error */
function debugMode(): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("film");
}

/**
 * The city film as atmosphere: muted, looping, behind everything, never
 * interactive and never in charge of the page. It is server-rendered with
 * autoplay so it can start before hydration; the poster underneath is the
 * fallback for every case where it cannot play (autoplay refused, decode
 * error, reduced motion, data saver). None of those affect the form.
 */
export function BackgroundFilm() {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    const frame = frameRef.current;
    if (!v || !frame) return;
    let alive = true;
    const mode = debugMode();

    const still = () => {
      // keep the poster: free the decoder and the connection
      frame.removeAttribute("data-ready");
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      conn?.saveData ||
      mode === "error"
    ) {
      still();
      return;
    }

    const ready = () => frame.setAttribute("data-ready", "");
    const onError = () => alive && still();
    const play = () => {
      v.play().catch((err: unknown) => {
        if (!alive) return;
        // autoplay refused (low-power mode, browser policy): stay on the poster
        // and try again on the visitor's first touch, which counts as a gesture
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          window.addEventListener("pointerdown", play, { once: true, passive: true });
        } else if (!(err instanceof DOMException && err.name === "AbortError")) onError();
      });
    };

    v.muted = true;
    v.addEventListener("playing", ready);
    v.addEventListener("error", onError);
    if (v.error) onError();
    else if (mode === "blocked") v.pause();
    else if (!v.paused && v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) ready();
    else play();

    return () => {
      alive = false;
      window.removeEventListener("pointerdown", play);
      v.removeEventListener("playing", ready);
      v.removeEventListener("error", onError);
      v.pause();
    };
  }, []);

  return (
    <div aria-hidden="true" className="film-bg">
      <div ref={frameRef} className="film-frame">
        <img
          src={FILM.poster}
          alt=""
          width={1280}
          height={720}
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
        <video
          ref={videoRef}
          src={FILM.src}
          poster={FILM.poster}
          muted
          autoPlay
          loop
          playsInline
          webkit-playsinline=""
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
        />
      </div>
      {/* the grade: maroon night at the edges, a calm dark centre for the form */}
      <div className="absolute inset-0 bg-[radial-gradient(85%_70%_at_50%_45%,rgb(18_6_10/55%)_0%,rgb(12_4_8/82%)_70%,rgb(7_9_14/92%)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(42_4_6/35%),transparent_35%,transparent_70%,rgb(7_9_14/70%))]" />
    </div>
  );
}
