import { useEffect, useState } from "react";

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

export function WhispersMarquee() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="header-marquee overflow-hidden border-t border-cream/10" aria-hidden="true">
      <div className="header-marquee-track flex w-max whitespace-nowrap">
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
