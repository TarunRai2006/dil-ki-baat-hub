import { Phone } from "lucide-react";
import { HELPLINES } from "@/lib/dilkibaat";

export function CrisisContacts({ className = "" }: { className?: string }) {
  return (
    <aside aria-label="Crisis support" className={className}>
      <p className="text-sm font-semibold text-cream">In crisis? Call for support now.</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {HELPLINES.map((helpline) => (
          <a
            key={helpline.number}
            href={`tel:${helpline.tel}`}
            aria-label={`Call ${helpline.name} at ${helpline.number}`}
            className="inline-flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-cream/85 underline decoration-primary/60 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Phone className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{helpline.name.replace(" (Govt. of India)", "").replace(" Foundation", "")}</span>
            <strong className="whitespace-nowrap font-mono text-sm text-primary">
              {helpline.number}
            </strong>
          </a>
        ))}
      </div>
    </aside>
  );
}
