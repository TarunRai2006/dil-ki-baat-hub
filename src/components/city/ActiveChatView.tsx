import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ChatThread } from "@/components/ChatWidget";
import { Button } from "@/components/ui/button";
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
import { endChatRoom, friendlyError, type StoredRoom } from "@/lib/confession";
import { subscribeToPush, type PushOptInStatus } from "@/lib/push-client";

export function ActiveChatView({
  room,
  onEnded,
  pushStatus,
  onPushStatus,
}: {
  room: StoredRoom;
  onEnded: () => void;
  pushStatus: PushOptInStatus | null;
  onPushStatus: (status: PushOptInStatus | null) => void;
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
      setProblem(friendlyError(error, "The chat could not be ended. Please try again."));
    } finally {
      setEnding(false);
    }
  };

  const enableAlerts = () => {
    onPushStatus(null);
    void subscribeToPush().then(onPushStatus);
  };

  return (
    <section
      className="release-glass mx-auto w-full max-w-2xl p-5 sm:p-8"
      aria-label="Your active chat"
    >
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.26em] text-primary">
        your private room
      </p>
      <h2 className="mt-2 font-display text-3xl text-cream sm:text-4xl">Your chat is here.</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Your story was received. You can return to this chat in this browser until it expires or you
        end it. The form returns when there is no active chat.
      </p>
      <div className="mt-6 h-[min(58svh,34rem)] min-h-80 overflow-hidden rounded-2xl border border-primary/25 bg-background/45">
        <ChatThread room={room} onEnded={onEnded} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p role="status" className="text-xs text-muted-foreground">
            {pushStatus === "enabled"
              ? "Browser alerts enabled on this device."
              : pushStatus === "blocked"
                ? "Browser alerts are blocked in site settings."
                : pushStatus === "unsupported"
                  ? "This browser does not support push alerts."
                  : pushStatus === "failed"
                    ? "Browser alerts could not be saved. You can try again."
                    : pushStatus === "dismissed"
                      ? "Browser alerts were not enabled. You can try again."
                      : "Browser alerts are optional."}
          </p>
          {pushStatus !== "enabled" && pushStatus !== "blocked" && pushStatus !== "unsupported" && (
            <Button variant="link" className="mt-1 h-auto px-0 text-primary" onClick={enableAlerts}>
              Enable browser alerts
            </Button>
          )}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="rounded-full" disabled={ending}>
              {ending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              End chat
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                This ends the room and deletes its messages from the live database. You cannot
                reopen it. Your original form submission remains with the mentor team.
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
