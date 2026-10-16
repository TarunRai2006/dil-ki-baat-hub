export const CATEGORIES = [
  "Relationship",
  "Career",
  "Family",
  "Anxiety",
  "Self thoughts",
  "Social taboos",
  "Confusion",
  "Other",
] as const;

/** The marquee strip: things people actually carry, said the way they say it. */
export const HINGLISH_THOUGHTS = [
  "Ghar wale career set chahte hain, par mera dil kuch aur keh raha hai...",
  "What if I am wasting my twenties?",
  "Bachpan ke dost ab stranger se lagte hain... is it normal?",
  "I smile all day and overthink at 2 AM.",
  "Pyaar tha ya sirf comfort? Samjh nahi aata.",
  "Everyone my age seems so far ahead of me.",
  "Sabko lagta hai main strong hoon. Nobody asks twice.",
  "I said yes when I meant no. Again.",
];

export const INTENTS = [
  { value: "Advice", label: "I want advice" },
  { value: "Express", label: "I want to be heard" },
  { value: "Both", label: "Both" },
] as const;

// Keep the historical "Both" value readable in the dashboard, but do not
// offer it on new stories.
export const FORM_INTENTS = INTENTS.filter((intent) => intent.value !== "Both");

export const TTL_OPTIONS = [
  { value: "1h", label: "Disappear in 1 hour" },
  { value: "24h", label: "Disappear in 24 hours" },
  { value: "never", label: "Never disappear" },
] as const;

export const MOOD_LABELS: Record<number, string> = {
  1: "Very Low",
  2: "Low",
  3: "Okay",
  4: "Better",
  5: "Uplifted",
};

export const AMBIENT_PROMPTS = [
  "I keep choosing everyone else first.",
  "Ever felt alone in a crowded room?",
  "Was it love, or was it just comfort?",
  "Everyone thinks I am the strong one.",
  "I smile all day and cry at night.",
  "I do not know who I am without them.",
  "My parents want a life I never picked.",
  "Everyone my age seems so far ahead.",
  "I said yes when I meant no. Again.",
  "What if I am wasting my twenties?",
  "I miss a person who was not good for me.",
  "I am tired in a way sleep does not fix.",
];

/** Short anonymous lines shown on the wall. Illustrative, no identifying detail. */
export const WHISPERS = [
  {
    text: "I told my family I was fine for two years. Writing it here was the first time I said otherwise.",
    tag: "Family",
  },
  {
    text: "I was not looking for answers. I just needed one person to read it and not flinch.",
    tag: "Self",
  },
  {
    text: "Someone replied with the exact thing I had been afraid to admit to myself.",
    tag: "Relationship",
  },
  {
    text: "The chat disappeared after an hour. Somehow that made it easier to be honest.",
    tag: "Anxiety",
  },
];

/** Why writing it down actually works. Short, plainly worded. */
export const WHY_IT_WORKS = [
  {
    k: "Naming it",
    t: "Put a feeling into words",
    d: "Writing can help you notice what has been weighing on you and what you may need next.",
  },
  {
    k: "Being witnessed",
    t: "Be heard without pressure",
    d: "You can ask for advice or simply to be heard. Your choice tells the team what you need.",
  },
  {
    k: "Distance",
    t: "Share without a real name",
    d: "No account is needed. Leave out identifying details and share only what feels right to you.",
  },
  {
    k: "Perspective",
    t: "Get a thoughtful response",
    d: "A counsellor or therapist may respond in your private chat. Replies can take time.",
  },
];

export const FAQS = [
  {
    q: "Will anyone know it was me?",
    a: "We do not ask for your real name, email or phone number. Authorised counsellors and therapists can read what you share. Please leave out identifying details; no online service can promise perfect anonymity.",
  },
  {
    q: "Do I have to be in crisis to write?",
    a: "Not at all. A restless week, a friendship that changed, a decision you keep postponing. All of it belongs here.",
  },
  {
    q: "What if I do not want advice?",
    a: "Choose “I want to be heard” on the form. The person who reads your story will see that preference.",
  },
  {
    q: "Who can respond?",
    a: "Verified counsellors and therapists may reply in your private chat. A reply is not guaranteed or immediate. If you are in danger, use the crisis contacts on this page.",
  },
];

export const HELPLINES = [
  {
    name: "Tele-MANAS (Govt. of India)",
    number: "14416",
    detail: "Free, 24×7 mental health support in 20+ Indian languages.",
    tel: "14416",
  },
  {
    name: "Vandrevala Foundation",
    number: "9999 666 555",
    detail: "24×7 free counselling helpline across India.",
    tel: "+919999666555",
  },
];

const ANON_KEY = "dkb_anon_user_id";

export function getAnonUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    // Submitting still works when browser storage is blocked, but this visitor
    // cannot reopen a room after leaving the page.
    return crypto.randomUUID();
  }
}
