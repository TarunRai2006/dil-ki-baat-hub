import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service and Privacy Policy | Dil Ki Baat" },
      {
        name: "description",
        content:
          "How Dil Ki Baat handles stories, anonymous chats, notifications, privacy and safety.",
      },
    ],
  }),
  component: Terms,
});

const sections = [
  {
    title: "What this service offers",
    paragraphs: [
      "Dil Ki Baat is an anonymous support space run by aapkamentor.ai. Verified counsellors and therapists may read and respond to your story or chat. A reply is not guaranteed. This service is not an emergency service; do not wait for a chat reply if you need urgent help.",
      "If you or someone else is in immediate danger, call emergency services (112 in India). For mental health support in India, Tele-MANAS is available at 14416. Please do not wait for a reply here in a crisis.",
    ],
  },
  {
    title: "Who can use it",
    paragraphs: [
      "You must be at least 16. By submitting a story, you confirm that you meet this age requirement and agree to these Terms of Service and this Privacy Policy. We do not collect or verify a date of birth or age band for new stories. If you are under 16, do not submit a story; speak with a trusted adult.",
      "Visitors aged 16–17 must have a parent or guardian's permission before submitting. We do not currently verify that permission. Public sharing is off for all new stories. We are reviewing the additional safeguards needed for minors before public launch.",
    ],
  },
  {
    title: "What we collect and why",
    paragraphs: [
      "We store your three written answers as one private story, along with chat messages. You may also choose a topic, a 1–5 feeling rating, and whether you want advice or to be heard. The reply choice is required. If you ask for advice, you can choose when the chat expires. Older stories may include a private question, nickname, age band or public sharing choice. A random browser ID and request ID help reconnect your chat, prevent duplicates and limit abuse. We do not ask for your real name, email address or phone number. Please leave identifying details about yourself and others out of stories and chats.",
      "The service stores timestamps, moderation status and notes made by authorised counsellors and therapists. It may process a limited, hashed network identifier for rate limiting. Hosting and database providers may process technical logs such as IP addresses. We cannot promise that a story is impossible to identify from its content. Chats are accessible to authorised counsellors and therapists and are not end-to-end encrypted.",
    ],
  },
  {
    title: "Your chat and this browser",
    paragraphs: [
      "You can have one active chat in this browser at a time. While it is active, the chat replaces the story form. Closing the tab does not end the chat. When you return in the same browser with its storage intact, the chat opens again. A random secret stored in this browser authorises chat access; someone who gets that secret or uses your unlocked browser may read your chat. Clearing browser data, using a private window or changing devices can permanently remove your access. We do not offer account or cross-device recovery.",
      "If you ask for advice, you can choose a one-hour, 24-hour or no-expiry chat; no expiry is selected by default. If you choose to be heard, your chat has no expiry setting and remains until you end it. A timed chat stops being readable when its time runs out, and its messages are scheduled for deletion from the live database about a day later when the database scheduler is running. Choosing End chat closes the room and deletes its messages from the live database immediately. The original story remains stored separately for moderation. Backups and provider logs may retain copies for their own limited retention periods.",
    ],
  },
  {
    title: "Public sharing",
    paragraphs: [
      "Public sharing is off for all new stories. The team cannot select a new story for public display from the current form. Older stories with a Yes choice may still appear if a counsellor or therapist approved and featured them. Chat messages are not part of public stories. No edit can guarantee anonymity.",
      "You own what you write. By submitting now, you permit us to store and moderate it to operate this service, but you do not grant permission for public sharing. For older stories where a visitor chose Yes, the earlier permission applied to edited anonymous publication. You can ask us to remove a published story using the contact below; removal from reposts or screenshots outside our control cannot be guaranteed.",
    ],
  },
  {
    title: "Browser notifications",
    paragraphs: [
      "Notifications are optional. Your browser may ask for permission when you first interact with the story form or chat. If you allow them, the browser supplies a push subscription endpoint and keys that we store to deliver general announcements. This is separate from chat and does not notify you of every counsellor or therapist reply. A notification may appear through your browser or operating system even when this page is closed. Delivery depends on browser permission, operating system settings and the push service; it is not guaranteed. You can turn off alerts in your browser's site settings. An invalid subscription is removed when a send fails.",
    ],
  },
  {
    title: "Retention, access and your choices",
    paragraphs: [
      "Stories and moderation records do not currently have an automatic deletion date. Authorised counsellors and therapists can review, archive or remove a story and use the dashboard. We use access controls and a chat secret to limit access, but no online service can guarantee absolute security.",
      "You may request access, correction or deletion of your story, chat information or push subscription by emailing dil.ki.baat.humare.sath@gmail.com. Because there is no account or verified identity, include enough information for us to locate the record without sending additional sensitive details. We may be unable to link you to a record after your browser secret is lost, and may retain records where required by law or for security.",
    ],
  },
  {
    title: "Community rules and service limits",
    paragraphs: [
      "Do not share another person's private information, threaten or harass people, post hate speech or sexual content involving minors, spam the service, or encourage self-harm. We may hide or remove content and close chats that violate these rules. Please use your own judgment before acting on a response. We may change or interrupt the service, and these terms may be updated on this page.",
    ],
  },
];

function Terms() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
        <h1 className="font-display text-4xl text-gradient-gold sm:text-5xl">
          Terms of Service and Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated 16 October 2026</p>
        <div className="mt-7 rounded-2xl cream-card p-5">
          <p className="font-display text-xl">Before you share</p>
          <p className="mt-2 text-sm leading-6">
            This is a 16+ listening space, not emergency care. Please leave real names and contact
            details out of your story. Your chat can reopen on this browser until you end it or it
            expires. New stories are kept private from public display.
          </p>
        </div>
        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section
              key={section.title}
              id={
                section.title === "What this service offers"
                  ? "terms"
                  : section.title === "What we collect and why"
                    ? "privacy"
                    : undefined
              }
              className="scroll-mt-28"
            >
              <h2 className="font-display text-2xl text-primary">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted-foreground">
          <Link to="/" className="text-primary underline underline-offset-4">
            ← Back to Dil Ki Baat
          </Link>
        </p>
      </main>
    </div>
  );
}
