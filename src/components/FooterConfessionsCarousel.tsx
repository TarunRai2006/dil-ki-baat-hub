import { useEffect, useRef, useState } from "react";
import { fetchWhispers } from "@/lib/confession";

// These are examples, not visitor submissions. Private stories never enter this carousel.
const EXAMPLE_CONFESSIONS = [
  "I say I'm fine, but I have been carrying a lot lately.",
  "I miss a friend and do not know how to reach out.",
  "I want a different future, but I am scared to disappoint my family.",
  "I keep saying yes when I really need a break.",
  "I feel lonely, even in a room full of people.",
  "I wish I could tell someone how much that goodbye hurt.",
] as const;

export function FooterConfessionsCarousel() {
  const sectionRef = useRef<HTMLElement>(null);
  const [shared, setShared] = useState<string[]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchWhispers()
      .then((lines) => {
        if (active) setShared(lines.filter((line) => line.trim().length > 0));
      })
      .catch(() => {
        // Keep the labelled examples if the public feed is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!("IntersectionObserver" in window) || !sectionRef.current) {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setStarted(true);
        observer.disconnect();
      }
    });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  const lines = shared.length > 0 ? shared : EXAMPLE_CONFESSIONS;
  const items = Array.from(
    { length: Math.max(6, lines.length) },
    (_, index) => lines[index % lines.length],
  );

  return (
    <section
      ref={sectionRef}
      aria-labelledby="footer-confessions-title"
      data-confessions-source={shared.length > 0 ? "approved" : "examples"}
      data-started={started}
      className="relative z-40 overflow-hidden border-t border-primary/25 bg-background pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 text-cream sm:pt-10"
    >
      <div className="mx-auto max-w-5xl px-6 sm:px-10">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.28em] text-primary">
          Words from the heart
        </p>
        <h2 id="footer-confessions-title" className="mt-2 font-display text-2xl sm:text-3xl">
          Confessions
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
          {shared.length > 0
            ? "Anonymous excerpts shared with permission and approved for this space."
            : "Examples of what someone might share. These are not visitor submissions."}
        </p>
      </div>

      <div className="footer-confessions-window mt-6 overflow-hidden sm:mt-7">
        <div
          className="footer-confessions-track flex w-max"
          style={{ animationDuration: `${items.length * 6}s` }}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0" aria-hidden={copy === 1 ? true : undefined}>
              {items.map((line, index) => (
                <blockquote
                  key={`${copy}-${index}`}
                  aria-hidden={index >= lines.length || undefined}
                  className="mx-2 flex w-64 shrink-0 items-center rounded-xl border border-primary/30 bg-primary/5 px-5 py-5 font-display text-base italic leading-snug text-cream/90 sm:w-80 sm:text-lg"
                >
                  “{line}”
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
