import { Link } from "@tanstack/react-router";
import { Instagram, Mail, ShieldCheck } from "lucide-react";
import { CrisisContacts } from "@/components/CrisisContacts";
import { FooterConfessionsCarousel } from "@/components/FooterConfessionsCarousel";

const EMAIL = "dil.ki.baat.humare.sath@gmail.com";
const INSTAGRAM = "https://instagram.com/dil.ki.baat.sabkesath";

export function SiteFooter() {
  return (
    <footer className="relative z-20 bg-background px-6 pt-14 shadow-[0_-60px_80px_-40px_rgb(0_0_0/90%)] sm:px-10">
      <div className="mx-auto max-w-5xl pb-10">
        <div className="hairline mb-12" />

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-12">
          <div className="md:col-span-2 lg:col-span-1">
            <p className="font-display text-2xl italic leading-snug text-cream/85">
              Your story, without asking for your name.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Dil Ki Baat is an anonymous listening space by{" "}
              <span className="text-cream/80">aapkamentor.ai</span>. Verified counsellors and
              therapists can review stories and respond in private chats.
            </p>
            <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              No account is required. This browser stores a private chat key so you can return.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Reach out
            </p>
            <ul className="mt-5 space-y-4 text-sm">
              <li>
                <a
                  href={`mailto:${EMAIL}`}
                  className="group inline-flex items-start gap-3 text-cream/85 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="break-all underline decoration-primary/30 underline-offset-4 transition-colors group-hover:decoration-primary">
                    {EMAIL}
                  </span>
                </a>
              </li>
              <li>
                <a
                  href={INSTAGRAM}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-3 text-cream/85 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Instagram className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="underline decoration-primary/30 underline-offset-4 transition-colors group-hover:decoration-primary">
                    @dil.ki.baat.sabkesath
                  </span>
                </a>
              </li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground/80">
              You can also contact us on Instagram. Replies may take time.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              The fine print
            </p>
            <ul className="mt-5 space-y-3 text-sm text-cream/85">
              <li>
                <Link
                  to="/terms"
                  className="underline decoration-primary/50 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Terms of Service and Privacy Policy
                </Link>
              </li>
            </ul>
            <CrisisContacts className="mt-5" />
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground/80">
              Support from verified counsellors and therapists. Not an emergency service.
            </p>
          </div>
        </div>

        <div className="hairline my-10" />

        <div className="flex flex-col items-start justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} aapkamentor.ai. Dil Ki Baat. All rights reserved.</p>
          <p className="text-muted-foreground/80">Made with a lot of feeling, in India.</p>
        </div>
      </div>
      <div className="-mx-6 sm:-mx-10">
        <FooterConfessionsCarousel />
      </div>
    </footer>
  );
}
