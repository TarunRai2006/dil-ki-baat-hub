import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms and Privacy | Dil Ki Baat" },
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
      "Dil Ki Baat is a community listening space run by aapkamentor.ai. A mentor may read and respond to your story or chat, but a response is not guaranteed. Mentors can see the content you submit. This is not therapy, medical or legal advice, or an emergency service.",
      "If you or someone else is in immediate danger, call emergency services (112 in India). For mental health support in India, Tele-MANAS is available at 14416. Please do not wait for a reply here in a crisis.",
    ],
  },
  {
    title: "Who can use it",
    paragraphs: [
      "You must be at least 16. We ask you to select an age group before submitting, but do not ask for or verify a date of birth. Visitors aged 16 or 17 cannot choose public sharing in the form. If you are under 16, do not submit a story; speak with a trusted adult or call Childline India at 1098.",
      "Because we cannot verify age or parental consent, the age control is a self-declaration. We are reviewing the additional safeguards needed for minors before public launch.",
    ],
  },
  {
    title: "What we collect and why",
    paragraphs: [
      "We store your story, self-declared age group, category, mood, request for advice, optional nickname and question, your sharing choice, and any enabled chat messages. We also store a random browser ID and request ID to reconnect your chat, prevent duplicate requests and limit abuse. We do not ask for your real name, email address or phone number. Please do not put identifying details about yourself or others in a story or chat.",
      "The service stores timestamps, moderation status and mentor notes. It may process a limited, hashed network identifier for rate limiting. Hosting and database providers may process technical logs such as IP addresses. We cannot promise that a story is impossible to identify from its content. Chats are accessible to authorised mentors and are not end-to-end encrypted.",
    ],
  },
  {
    title: "Your chat and this browser",
    paragraphs: [
      "You can have one active chat in this browser at a time. While it is active, the chat replaces the story form. Closing the tab does not end the chat. When you return in the same browser with its storage intact, the chat opens again. A random secret stored in this browser authorises chat access; someone who gets that secret or uses your unlocked browser may read your chat. Clearing browser data, using a private window or changing devices can permanently remove your access. We do not offer account or cross-device recovery.",
      "You choose a chat duration of one hour, 24 hours or no automatic expiry. After expiry, messages cannot be read through the chat. Expired messages are scheduled for deletion from the live database about a day later, when the database scheduler is running. Choosing End chat closes the room and deletes its messages from the live database immediately. The original story remains stored separately for moderation. Backups and provider logs may retain copies for their own limited retention periods.",
    ],
  },
  {
    title: "Public sharing",
    paragraphs: [
      "The default sharing choice is No. Only a story marked Yes can be selected by a mentor for public display. Maybe does not authorise public sharing. A Yes choice does not guarantee publication. Mentors may edit a selected story to remove identifying details, but no edit can guarantee anonymity. Chat messages are not part of public stories. Visitors aged 16 or 17 cannot choose Yes in the form.",
      "You own what you write. By submitting, you permit us to store and moderate it to operate this service. If you select Yes, you also permit us to edit and publish the story anonymously on Dil Ki Baat channels. You can ask us to remove a published story using the contact below; removal from reposts or screenshots outside our control cannot be guaranteed.",
    ],
  },
  {
    title: "Browser notifications",
    paragraphs: [
      "Notifications are optional. If you allow them, the browser supplies a push subscription endpoint and keys that we store to deliver general announcements. This is separate from chat and does not notify you of every mentor reply. A notification may appear through your browser or operating system even when this page is closed. Delivery depends on browser permission, operating system settings and the push service; it is not guaranteed. You can turn off alerts in your browser's site settings. An invalid subscription is removed when a send fails.",
    ],
  },
  {
    title: "Retention, access and your choices",
    paragraphs: [
      "Stories and moderation records do not currently have an automatic deletion date. An authorised mentor can review, archive or remove a story. Only authorised mentors can use the admin dashboard. We use access controls and a chat secret to limit access, but no online service can guarantee absolute security.",
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
        <h1 className="font-display text-4xl text-gradient-gold sm:text-5xl">Terms and Privacy</h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated 13 October 2026</p>
        <div className="mt-7 rounded-2xl cream-card p-5">
          <p className="font-display text-xl">Before you share</p>
          <p className="mt-2 text-sm leading-6">
            This is a 16+ listening space, not emergency care. Please leave real names and contact
            details out of your story. Your chat can reopen on this browser until you end it or it
            expires. Only stories you mark Yes may be considered for public sharing.
          </p>
        </div>
        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.title}>
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
