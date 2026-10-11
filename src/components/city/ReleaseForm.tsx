import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CATEGORIES, HIGHLIGHT_OPTIONS, INTENTS, MOOD_LABELS, TTL_OPTIONS } from "@/lib/dilkibaat";
import {
  CONTENT_MAX,
  NICKNAME_MAX,
  QUESTION_MAX,
  confessionSchema,
  friendlyError,
  submitConfession,
  type StoredRoom,
} from "@/lib/confession";
import { scrollControls } from "@/lib/scroll-state";
import { playClick, playRelease } from "@/lib/audio-engine";

const EASE = [0.16, 1, 0.3, 1] as const;

/** A numbered, hairline-separated section. Deliberately not a box. */
function Field({
  n,
  label,
  hint,
  children,
  delay,
}: {
  n: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <div
      style={{ animationDelay: `${250 + delay * 500}ms` }}
      className="rise-in border-t border-cream/10 pt-5 first:border-t-0 first:pt-0"
    >
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
      onClick={() => {
        playClick(0.6);
        onClick();
      }}
      className={`rounded-full border px-3.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] transition-all duration-300 ${
        active
          ? "border-primary/70 bg-primary/15 text-primary"
          : "border-cream/12 text-muted-foreground hover:border-primary/40 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/** The release panel that floats in once the city has turned crimson. */
export function ReleaseForm({
  onReleased,
}: {
  onReleased: (text: string, room: StoredRoom | null) => void;
}) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("Relationship");
  const [intent, setIntent] = useState<string>("Both");
  const [mood, setMood] = useState(2);
  const [question, setQuestion] = useState("");
  const [highlight, setHighlight] = useState<string>("Maybe");
  const [nickname, setNickname] = useState("");
  const [chat, setChat] = useState(true);
  const [ttl, setTtl] = useState<string>("24h");
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [released, setReleased] = useState(false);
  const [chatOpened, setChatOpened] = useState(false);
  const successRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);
  const inFlight = useRef(false);

  // One id per version of the confession: a double click or a retry of the
  // same words reuses it, so the database stores it once. Editing makes a new one.
  const requestId = useRef<string>("");
  useEffect(() => {
    requestId.current = crypto.randomUUID();
  }, [content, category, intent, mood, question, highlight, nickname, chat, ttl]);

  const submit = async () => {
    if (inFlight.current) return;
    const input = {
      content,
      category,
      intent,
      emotional_state: mood,
      community_question: question,
      highlight_on_instagram: highlight,
      nickname,
      chat_enabled: chat,
      chat_ttl: ttl,
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
      onReleased(parsed.data.content, result.room);
      setContent("");
      setQuestion("");
      setChatOpened(!!result.room);
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
    <div ref={panelRef} className="release-glass rise-in mx-auto w-full max-w-2xl p-5 sm:p-8">
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
              Your words have been received.
              <span className="block italic text-gradient-gold">Thank you for sharing.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              A real person will read this with care. Nothing about it can be traced back to you.
              {chatOpened
                ? " Your disappearing chat is ready whenever you are: open it from “Your chat”."
                : ""}
            </p>
            <Button
              variant="ghost"
              className="mt-8 rounded-full font-mono text-[0.62rem] uppercase tracking-[0.26em] text-primary"
              onClick={() => {
                refocus.current = true;
                setReleased(false);
              }}
            >
              Write something else
            </Button>
            <p className="mt-6 font-mono text-[0.5rem] uppercase tracking-[0.22em] text-muted-foreground/70">
              In crisis? Tele-MANAS 14416 · Vandrevala 9999 666 555
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: EASE }}
            onAnimationComplete={() => {
              // back from the success view: put the cursor where the next words go
              if (!refocus.current) return;
              refocus.current = false;
              textareaRef.current?.focus({ preventScroll: true });
            }}
          >
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.36em] text-primary/75">
              your turn · anonymous
            </p>
            <h2 className="mt-3 font-display text-[1.75rem] leading-tight text-cream sm:text-4xl">
              Say the thing you have been
              <span className="block italic text-gradient-gold">rehearsing in your head.</span>
            </h2>
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground sm:text-sm">
              No name, no email, no account. Nobody can trace this back to you — that is exactly why
              people finally tell the truth here.
            </p>

            <div className="mt-7 space-y-5">
              <Field
                n="01"
                label="What is on your mind?"
                hint="Write it the way it actually sits in your chest. Unedited is fine."
                delay={0.15}
              >
                <Textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (problem) setProblem(null);
                  }}
                  rows={5}
                  maxLength={CONTENT_MAX}
                  aria-label="What is on your mind?"
                  aria-invalid={!!problem && content.trim().length < 10}
                  placeholder="Start anywhere. Even mid-sentence."
                  className="resize-none border-cream/12 bg-background/40 text-base text-cream sm:text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
                />
                <p className="mt-1.5 text-right font-mono text-[0.55rem] text-muted-foreground/60">
                  {content.length}/{CONTENT_MAX}
                </p>
              </Field>

              <Field n="02" label="Where does it hurt?" delay={0.24}>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <Pill key={c} active={category === c} onClick={() => setCategory(c)}>
                      {c}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field n="03" label="What do you want back?" delay={0.32}>
                <div className="flex flex-wrap gap-2">
                  {INTENTS.map((i) => (
                    <Pill
                      key={i.value}
                      active={intent === i.value}
                      onClick={() => setIntent(i.value)}
                    >
                      {i.label}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field n="04" label="How heavy is today?" delay={0.4}>
                <div className="flex items-center justify-between font-mono text-[0.55rem] uppercase tracking-[0.2em]">
                  <span className="text-muted-foreground">Barely holding on</span>
                  <span className="text-primary">{MOOD_LABELS[mood]}</span>
                  <span className="text-muted-foreground">Actually okay</span>
                </div>
                <Slider
                  value={[mood]}
                  min={1}
                  max={5}
                  step={1}
                  onValueChange={(v) => setMood(v[0])}
                  className="mt-3.5"
                />
              </Field>

              <Field
                n="05"
                label="One question for the community"
                hint="Optional. If strangers could answer one thing for you, what would it be?"
                delay={0.48}
              >
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={QUESTION_MAX}
                  aria-label="One question for the community"
                  placeholder="Was I wrong to walk away?"
                  className="border-cream/12 bg-background/40 text-base text-cream sm:text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
                />
              </Field>

              <Field
                n="06"
                label="Can we share this anonymously?"
                hint="Never with your name or any detail that could identify you. Only the words."
                delay={0.56}
              >
                <div className="flex flex-wrap gap-2">
                  {HIGHLIGHT_OPTIONS.map((h) => (
                    <Pill key={h} active={highlight === h} onClick={() => setHighlight(h)}>
                      {h}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field
                n="07"
                label="A name that is not yours"
                hint="Optional. Something we can call you if we reply."
                delay={0.64}
              >
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={NICKNAME_MAX}
                  aria-label="A name that is not yours"
                  placeholder="Gumnam Dost"
                  className="border-cream/12 bg-background/40 text-base text-cream sm:text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
                />
              </Field>

              <Field
                n="08"
                label="Talk to someone right now?"
                hint="A live, anonymous chat that deletes itself. Nothing is kept after it closes."
                delay={0.72}
              >
                <div className="flex items-center gap-3">
                  <Switch checked={chat} onCheckedChange={setChat} />
                  <span className="text-xs text-muted-foreground">
                    {chat
                      ? "Open a disappearing chat with me"
                      : "No chat, I just needed to write it"}
                  </span>
                </div>
                {chat && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="mt-4 flex flex-wrap gap-2 overflow-hidden"
                  >
                    {TTL_OPTIONS.map((t) => (
                      <Pill key={t.value} active={ttl === t.value} onClick={() => setTtl(t.value)}>
                        {t.label}
                      </Pill>
                    ))}
                  </motion.div>
                )}
              </Field>
            </div>

            <div className="rise-in mt-8" style={{ animationDelay: "660ms" }}>
              <Button
                onClick={submit}
                disabled={loading}
                size="lg"
                className="group w-full rounded-full font-mono text-[0.68rem] uppercase tracking-[0.28em] glow-gold"
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {loading ? "Letting go…" : "Let it go"}
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <div aria-live="polite" className="mt-3 min-h-5 text-center text-xs">
                {problem && (
                  <p role="alert" className="text-destructive">
                    {problem}
                  </p>
                )}
              </div>
              <p className="mt-2 text-center font-mono text-[0.5rem] uppercase tracking-[0.22em] text-muted-foreground/70">
                In crisis? Tele-MANAS 14416 · Vandrevala 9999 666 555
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
