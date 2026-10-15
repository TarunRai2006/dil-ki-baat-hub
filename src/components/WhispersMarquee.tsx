import { useEffect, useRef, useState } from "react";

/** Illustrative thoughts only; private submissions never appear in this strip. */
const THOUGHTS = [
  "I miss who I used to be.",
  "I said I was fine. I wasn't.",
  "I need a fresh start.",
  "I feel lonely in a full room.",
  "I wish I could say no.",
  "I am proud I made it today.",
  "I still think about that goodbye.",
  "I want to be understood.",
  "I am learning to ask for help.",
  "Maybe tomorrow will feel lighter.",
] as const;

export function WhispersMarquee({ startOnView = false }: { startOnView?: boolean }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(!startOnView);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!startOnView) return;
    if (!("IntersectionObserver" in window) || !stripRef.current) {
      setStarted(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setStarted(true);
        observer.disconnect();
      }
    });
    observer.observe(stripRef.current);
    return () => observer.disconnect();
  }, [startOnView]);

  useEffect(() => {
    if (!started) return;
    const timer = window.setTimeout(() => setVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [started]);

  if (!visible) return null;

  return (
    <div
      ref={stripRef}
      className="header-marquee overflow-hidden border-y border-primary/20"
      style={{ animationPlayState: started ? "running" : "paused" }}
      data-marquee={startOnView ? "bottom" : "top"}
      aria-hidden="true"
    >
      <div
        className="header-marquee-track flex w-max whitespace-nowrap"
        style={{ animationPlayState: started ? "running" : "paused" }}
      >
        {THOUGHTS.map((thought) => (
          <span
            key={thought}
            className="header-marquee-thought flex shrink-0 items-center gap-5 px-5 py-2 font-sans text-xs font-semibold tracking-wide text-cream/85 sm:text-sm"
          >
            <span className="size-1 shrink-0 rounded-full bg-primary/70" />
            {thought}
          </span>
        ))}
      </div>
    </div>
  );
}
