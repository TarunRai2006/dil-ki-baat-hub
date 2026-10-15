import { Link } from "@tanstack/react-router";
import { HelpModal } from "@/components/HelpModal";
import { AudioToggle } from "@/components/AudioToggle";

export function SiteHeader() {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="glass-panel mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-full py-2.5 pl-3 pr-2.5 sm:pl-5 sm:pr-4">
          <Link to="/" className="group flex min-w-0 items-center gap-3">
            <img
              src="/dil-ki-baat-mark.png"
              alt="Dil Ki Baat Haven logo"
              className="size-10 shrink-0 rounded-lg border border-primary/25 object-contain"
            />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="truncate font-display text-[1.15rem] tracking-tight text-cream">
                Dil Ki Baat
              </span>
              <span className="mt-1 truncate text-[0.58rem] uppercase tracking-[0.24em] text-primary/70">
                by aapkamentor.ai
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              to="/terms"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-primary sm:inline"
            >
              Terms of Service
            </Link>
            <AudioToggle />
            <HelpModal />
          </div>
        </div>
      </header>
      {/* the header floats; this keeps page content from starting underneath it */}
      <div
        aria-hidden="true"
        className="h-[calc(5rem+env(safe-area-inset-top))] sm:h-[calc(6rem+env(safe-area-inset-top))]"
      />
    </>
  );
}
