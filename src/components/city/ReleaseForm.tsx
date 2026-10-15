import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { CrisisContacts } from "@/components/CrisisContacts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONTENT_MIN,
  confessionSchema,
  friendlyError,
  submitConfession,
  type StoredRoom,
} from "@/lib/confession";
import { FEELINGS_MAX, STORY_MAX, SUPPORT_MAX, composeStory } from "@/lib/intake";
import { CATEGORIES, FORM_INTENTS, MOOD_LABELS, TTL_OPTIONS } from "@/lib/dilkibaat";
import { scrollControls } from "@/lib/scroll-state";
import { playRelease } from "@/lib/audio-engine";

const EASE = [0.16, 1, 0.3, 1] as const;
const ANSWER_CLASS =
  "resize-none border-cream/12 bg-background/40 text-base text-cream sm:text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40";

/** A numbered, hairline-separated section. Deliberately not a box. */
function Field({
  n,
  label,
  hint,
  children,
}: {
  n: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-cream/10 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[0.55rem] tracking-[0.24em] text-primary/60">{n}</span>
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.26em] text-cream/85">
          {label}
        </span>
      </div>
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:pl-8">{hint}</p>
      )}
      <div className="mt-3.5 pl-0 sm:pl-8">{children}</div>
    </div>
  );
}

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        active
          ? "border-primary/70 bg-primary/15 text-primary"
          : "border-cream/20 text-cream/75 hover:border-primary/50 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/** The release panel is present on the first paint for new visitors. */
export function ReleaseForm({
  onReleased,
}: {
  onReleased: (text: string, room: StoredRoom | null, intent: "Advice" | "Express") => void;
}) {
  const [content, setContent] = useState("");
  const [feelings, setFeelings] = useState("");
  const [support, setSupport] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [intent, setIntent] = useState<"Advice" | "Express" | null>(null);
  const [ttl, setTtl] = useState<(typeof TTL_OPTIONS)[number]["value"]>("never");
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [released, setReleased] = useState(false);
  const [submittedIntent, setSubmittedIntent] = useState<"Advice" | "Express" | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  // One id per version of the confession: a double click or a retry of the
  // same words reuses it, so the database stores it once. Editing makes a new one.
  const requestId = useRef<string>("");
  useEffect(() => {
    requestId.current = crypto.randomUUID();
  }, [content, feelings, support, category, mood, intent, ttl]);

  const submit = async () => {
    if (inFlight.current) return;
    if (content.trim().length < CONTENT_MIN) {
      const message = "Even one honest sentence is enough — but we need something to hold.";
      setProblem(message);
      toast.error(message);
      return;
    }
    if (!intent) {
      const message = "Choose whether you want advice or simply to be heard.";
      setProblem(message);
      toast.error(message);
      return;
    }
    const input = {
      content: composeStory({ story: content, feelings, support }),
      intent,
      emotional_state: mood,
      category,
      chat_ttl: intent === "Advice" ? ttl : "never",
    };
    const parsed = confessionSchema.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues[0].message;
      setProblem(message);
      toast.error(message);
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setProblem(null);
    try {
      const result = await submitConfession(input, requestId.current);
      playRelease();
      onReleased(parsed.data.content, result.room, intent);
      setSubmittedIntent(intent);
      setContent("");
      setFeelings("");
      setSupport("");
      setCategory(null);
      setMood(null);
      setIntent(null);
      setTtl("never");
      setReleased(true);
      // the confirmation is shorter than the form: bring the panel back into view
      if (panelRef.current) scrollControls.toElement(panelRef.current);
    } catch (err) {
      const message = friendlyError(
        err,
        "Something went wrong while sending your confession. Please try again.",
      );
      setProblem(message);
      toast.error(message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div
      ref={panelRef}
      data-room-view="form"
      className="release-glass mx-auto w-full max-w-2xl p-5 sm:p-8"
    >
      <AnimatePresence mode="wait" initial={false}>
        {released ? (
          <motion.div
            key="received"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.7, ease: EASE }}
            // keyboard and screen-reader users land on the confirmation
            onAnimationComplete={() => successRef.current?.focus({ preventScroll: true })}
            className="py-10 text-center sm:py-14"
          >
            <CheckCircle2 className="mx-auto size-7 text-primary" aria-hidden="true" />
            <h2
              ref={successRef}
              tabIndex={-1}
              className="mt-5 font-display text-[1.9rem] leading-tight text-cream outline-none sm:text-4xl"
            >
              Congratulations!!!!!
              <span className="block italic text-gradient-gold">You let it go.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Take a breath. Your story is here in your private chat.
            </p>
            {submittedIntent === "Advice" && (
              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                A verified counsellor or therapist can read your story and may reply here if you
                need more support. Replies are not immediate or guaranteed.
              </p>
            )}
            <CrisisContacts className="mx-auto mt-6 max-w-md text-left" />
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.36em] text-primary/75">
              your turn · anonymous
            </p>
            <h2 className="mt-3 font-display text-[1.75rem] leading-tight text-cream sm:text-4xl">
              Say the thing you have been
              <span className="block italic text-gradient-gold">rehearsing in your head.</span>
            </h2>
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground sm:text-sm">
              No account, email, or real name is required. Share only what you choose.
            </p>

            <div className="mt-7 space-y-5">
              <Field
                n="01"
                label="What happened, and what feels hardest right now?"
                hint="Begin anywhere. What led up to this, and what is difficult to say? Please leave out names and contact details."
              >
                <Textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (problem) setProblem(null);
                  }}
                  rows={5}
                  maxLength={STORY_MAX}
                  aria-label="What happened, and what feels hardest right now?"
                  aria-invalid={!!problem && content.trim().length < CONTENT_MIN}
                  placeholder="Start wherever it feels easiest."
                  className={ANSWER_CLASS}
                />
                <p className="mt-1.5 text-right font-mono text-[0.55rem] text-muted-foreground/60">
                  {content.length}/{STORY_MAX}
                </p>
              </Field>

              <Field
                n="02"
                label="When does it feel hardest, and what have you tried?"
                hint="Optional. Tell us how it affects your day and what has or has not helped."
              >
                <Textarea
                  value={feelings}
                  onChange={(e) => setFeelings(e.target.value)}
                  rows={3}
                  maxLength={FEELINGS_MAX}
                  aria-label="When does it feel hardest, and what have you tried?"
                  placeholder="For example, nights are hardest. Talking to a friend helped a little."
                  className={ANSWER_CLASS}
                />
              </Field>

              <Field
                n="03"
                label="What would you like us to understand or help with?"
                hint="Optional. Is there more we should know? Tell us if you want listening, perspective, or a next step."
              >
                <Textarea
                  value={support}
                  onChange={(e) => setSupport(e.target.value)}
                  rows={3}
                  maxLength={SUPPORT_MAX}
                  aria-label="What would you like us to understand or help with?"
                  placeholder="For example, please listen first. I am unsure what to do next."
                  className={ANSWER_CLASS}
                />
              </Field>

              <Field n="04" label="Where does it hurt?" hint="Choose a topic if one fits.">
                <div role="group" aria-label="Where does it hurt?" className="flex flex-wrap gap-2">
                  {CATEGORIES.map((choice) => (
                    <Pill
                      key={choice}
                      active={category === choice}
                      onClick={() => setCategory(category === choice ? null : choice)}
                    >
                      {choice}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field
                n="05"
                label="What do you want back?"
                hint="Choose the kind of support you want."
              >
                <div
                  role="group"
                  aria-label="What do you want back?"
                  className="flex flex-wrap gap-2"
                >
                  {FORM_INTENTS.map((choice) => (
                    <div key={choice.value} className="flex items-center gap-1">
                      <Pill
                        active={intent === choice.value}
                        onClick={() => {
                          setIntent(choice.value);
                          setProblem(null);
                        }}
                      >
                        {choice.label}
                      </Pill>
                      {choice.value === "Advice" && (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip disableHoverableContent>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="Advice terms"
                                className="rounded-full px-1 text-base font-bold text-primary underline decoration-primary/60 focus-visible:outline-2 focus-visible:outline-primary"
                              >
                                *
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-64 border border-primary/40 bg-background p-3 text-left leading-relaxed text-cream shadow-xl"
                            >
                              A verified counsellor or therapist can read your story and may reply
                              here if you need more support. Replies are not immediate or
                              guaranteed.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  ))}
                </div>
              </Field>

              <Field n="06" label="How heavy is today?" hint="Move the slider if a number helps.">
                <div className="flex items-center justify-between gap-2 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Very low</span>
                  <span className="text-primary" aria-live="polite">
                    {mood === null ? "Not chosen" : `${mood}/5 · ${MOOD_LABELS[mood]}`}
                  </span>
                  <span>Uplifted</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={mood ?? 3}
                  onChange={(e) => setMood(Number(e.target.value))}
                  aria-label="How heavy is today?"
                  className="mt-3 w-full cursor-pointer accent-primary"
                />
                {mood !== null && (
                  <button
                    type="button"
                    onClick={() => setMood(null)}
                    className="mt-2 text-xs text-primary underline underline-offset-4"
                  >
                    Clear rating
                  </button>
                )}
              </Field>

              {intent === "Advice" && (
                <Field n="07" label="How long should your chat stay open?">
                  <div
                    role="group"
                    aria-label="How long should your chat stay open?"
                    className="flex flex-wrap gap-2"
                  >
                    {TTL_OPTIONS.map((choice) => (
                      <Pill
                        key={choice.value}
                        active={ttl === choice.value}
                        onClick={() => setTtl(choice.value)}
                      >
                        {choice.label}
                      </Pill>
                    ))}
                  </div>
                </Field>
              )}
            </div>

            <div className="mt-8">
              <CrisisContacts className="mb-5" />
              {problem && (
                <p role="alert" className="mb-4 text-center text-xs text-destructive">
                  {problem}
                </p>
              )}
              <Button
                onClick={submit}
                disabled={loading}
                aria-busy={loading}
                size="lg"
                className="group min-h-12 w-full rounded-full font-sans text-base font-bold tracking-wide glow-gold sm:text-lg"
              >
                Let it Go
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                By submitting, you confirm you are at least 16 and agree to our{" "}
                <Link
                  to="/terms"
                  hash="terms"
                  className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  to="/terms"
                  hash="privacy"
                  className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
