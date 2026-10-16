import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ChatThread } from "@/components/ChatWidget";
import type { StoredRoom } from "@/lib/confession";

/** Disappearing anonymous chat, presented as a right-side sheet. */
export function ChatSheet({
  room,
  open,
  onOpenChange,
}: {
  room: StoredRoom;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-border bg-background/95 p-0 backdrop-blur-xl sm:max-w-md"
      >
        <SheetTitle className="sr-only">Anonymous chat</SheetTitle>
        <SheetDescription className="sr-only">
          A private, disappearing conversation with a Dil Ki Baat counsellor or therapist.
        </SheetDescription>
        {open && <ChatThread room={room} />}
      </SheetContent>
    </Sheet>
  );
}
