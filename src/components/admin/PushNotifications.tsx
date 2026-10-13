import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { notificationSchema, type SendNotificationResult } from "@/lib/push-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

async function adminRequest(method: "GET" | "POST", body?: object): Promise<unknown> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Your admin session has expired.");
  const response = await fetch("/api/push/admin", {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Admin access is required."
        : "The notification service is unavailable.",
    );
  return response.json() as Promise<unknown>;
}

export function PushNotifications() {
  const [count, setCount] = useState<number | null>(null);
  const [title, setTitle] = useState("Dil Ki Baat ❤️");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendNotificationResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false);

  const refreshCount = useCallback(async (): Promise<number | null> => {
    setRefreshing(true);
    try {
      const value = (await adminRequest("GET")) as { count: number };
      if (mounted.current) setCount(value.count);
      return value.count;
    } catch {
      if (mounted.current) toast.error("Could not load push subscriber count.");
      return null;
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshCount();
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  const draft = { title, body, url };
  const openConfirmation = async () => {
    const parsed = notificationSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const currentCount = await refreshCount();
    if (currentCount === null) return;
    if (currentCount === 0) {
      toast.error("No browsers are subscribed yet.");
      return;
    }
    setConfirm(true);
  };
  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const sent = (await adminRequest("POST", draft)) as SendNotificationResult;
      setResult(sent);
      setCount(Math.max(0, sent.total - sent.removedInvalid));
      setConfirm(false);
      if (sent.successful > 0) toast.success("Notification accepted by the push service.");
      else toast.error("No push service accepted this notification. Check the delivery counts.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notification send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="max-w-2xl rounded-2xl border border-border bg-card/60 p-5 sm:p-7">
      <h2 className="font-display text-2xl text-primary">Push Notifications</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Active subscriptions: {count === null ? "Loading…" : count.toLocaleString()}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 px-0 text-primary"
        onClick={() => void refreshCount()}
        disabled={refreshing}
      >
        {refreshing ? "Refreshing…" : "Refresh count"}
      </Button>
      {count === 0 && (
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          No browsers can receive a broadcast yet. Open the public site in a browser, submit the
          form, allow notifications, then refresh this count.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Delivery is best effort. No subscriber details are shown.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block text-sm">
          Title
          <Input
            className="mt-1"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Message
          <Textarea
            className="mt-1"
            value={body}
            maxLength={240}
            rows={4}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Destination path
          <Input
            className="mt-1"
            value={url}
            maxLength={200}
            onChange={(event) => setUrl(event.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Use / to open the main site when someone clicks the notification.
          </span>
        </label>
        <Button
          onClick={() => void openConfirmation()}
          disabled={sending || refreshing || count === null || count === 0}
        >
          Send notification
        </Button>
      </div>
      {result && (
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          Total: {result.total} · Successful: {result.successful} · Removed invalid:{" "}
          {result.removedInvalid}· Temporarily failed: {result.failedTemporary}
        </p>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!sending) setConfirm(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to all subscribed browsers?</DialogTitle>
            <DialogDescription>
              Approximately {count ?? "all"} browsers may receive this notification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 break-words text-sm">
            <p>
              <strong>Title:</strong> {title}
            </p>
            <p>
              <strong>Message:</strong> {body}
            </p>
            <p>
              <strong>Destination:</strong> {url}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={sending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={sending} onClick={() => void send()}>
              {sending ? "Sending…" : "Send notification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
