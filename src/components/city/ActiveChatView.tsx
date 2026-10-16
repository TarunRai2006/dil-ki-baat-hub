import { useState } from "react";
import { BrandLoader } from "@/components/BrandLoader";
import { ChatThread } from "@/components/ChatWidget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { endChatRoom, errorCode, friendlyError, type StoredRoom } from "@/lib/confession";

export function ActiveChatView({
  room,
  showWelcome,
  welcomeIntent,
  onCloseWelcome,
  onEnded,
}: {
  room: StoredRoom;
  showWelcome: boolean;
  welcomeIntent: "Advice" | "Express" | null;
  onCloseWelcome: () => void;
  onEnded: () => void;
}) {
  const [ending, setEnding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const endChat = async () => {
    if (ending) return;
    setEnding(true);
    setProblem(null);
    try {
      await endChatRoom(room);
      onEnded();
    } catch (error) {
      const code = errorCode(error);
      setProblem(
        code === "network" || code === "timeout"
          ? "The chat service is unavailable. Your chat was not ended and its messages were not deleted. Keep this browser's data and try again when the service is back."
          : friendlyError(error, "The chat could not be ended. Please try again."),
      );
    } finally {
      setEnding(false);
    }
  };

  return (
    <section
      className="release-glass mx-auto w-full max-w-2xl p-5 sm:p-8"
      aria-label="Your active chat"
    >
      <Dialog
        open={showWelcome}
        onOpenChange={(open) => {
          if (!open) onCloseWelcome();
        }}
      >
        <DialogContent className="z-[60] w-[calc(100vw-2rem)] max-w-md rounded-3xl border-primary/35 bg-background p-7 text-center shadow-[0_24px_80px_rgb(0_0_0/70%)] sm:p-9">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.28em] text-primary">
            Your words found a place
          </p>
          <DialogTitle className="font-display text-3xl leading-tight text-gradient-gold sm:text-4xl">
            Congratulations!!!!!<span className="block">You let it go.</span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-cream/85">
            Opening up takes courage. Take a breath. You have taken a meaningful step, and your
            story is here in your private chat.
          </DialogDescription>
          {welcomeIntent === "Advice" && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              A verified counsellor or therapist can read your story and may reply here if you need
              more support. Replies are not immediate or guaranteed.
            </p>
          )}
          <Button onClick={onCloseWelcome} className="mt-2 w-full rounded-full">
            Open my chat
          </Button>
        </DialogContent>
      </Dialog>
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.26em] text-primary">
        your private room
      </p>
      <h2 className="mt-2 font-display text-3xl text-cream sm:text-4xl">Your chat is here.</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Your story was received. You can return to this chat in this browser until you end it
        {room.expiresAt ? " or it expires" : ""}. The form returns when there is no active chat.
      </p>
      <div className="mt-6 h-[min(58svh,34rem)] min-h-80 overflow-hidden rounded-2xl border border-primary/25 bg-background/45">
        <ChatThread room={room} onEnded={onEnded} />
      </div>
      <div className="mt-5 flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="rounded-full" disabled={ending}>
              {ending && <BrandLoader size="small" label="Ending chat" />}
              End chat
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                This ends the room and deletes its messages from the live database. You cannot
                reopen it. Your original form submission remains with the counsellor and therapist
                team.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep chatting</AlertDialogCancel>
              <AlertDialogAction onClick={() => void endChat()}>
                End chat and delete messages
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {problem}
        </p>
      )}
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Closing this tab does not end the chat. Anyone with access to this browser profile may
        reopen it. Clearing site data removes your access token.
      </p>
    </section>
  );
}
