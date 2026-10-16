import { useEffect, useRef, useState } from "react";

// The original illustrative ticker lines. They are examples, not visitor submissions.
const CONFESSIONS = [
  'Someone in Pune just released: "I am tired in a way sleep does not fix."',
  'Someone in Delhi just released: "I said yes when I meant no. Again."',
  'Someone in Kochi just released: "My parents want a life I never picked."',
  'Someone in Jaipur just released: "I miss a person who was not good for me."',
  'Someone in Kolkata just released: "Everyone my age seems so far ahead of me."',
  'Someone in Indore just released: "I smile all day and overthink at 2 AM."',
] as const;

export function FooterConfessionsCarousel() {
  const stripRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <div
      ref={stripRef}
      aria-label="Confessions ticker"
      data-confessions-source="examples"
      data-started={started}
      className="flex min-w-0 items-center overflow-hidden border-t border-primary/25 bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <span className="sr-only">Illustrative examples, not visitor submissions.</span>

      <div className="footer-confessions-window min-w-0 flex-1 overflow-hidden">
        <div
          className="footer-confessions-track flex w-max whitespace-nowrap"
          style={{ animationDuration: "38s" }}
        >
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="flex min-w-[100vw] shrink-0 items-center gap-12 px-6"
              aria-hidden={copy === 1 ? true : undefined}
            >
              {CONFESSIONS.map((line, index) => (
                <span
                  key={`${copy}-${index}`}
                  className="shrink-0 font-mono text-[0.62rem] tracking-wide text-muted-foreground"
                >
                  {line}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
