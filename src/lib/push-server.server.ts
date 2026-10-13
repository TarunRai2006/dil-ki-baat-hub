import { createHmac } from "node:crypto";
import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  NotificationPayload,
  PushSubscriptionPayload,
  SendNotificationResult,
} from "./push-shared";

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function limitedBody(request: Request, max = 4096): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new Error("invalid_content_type");
  const length = Number(request.headers.get("content-length"));
  if (length > max) throw new Error("body_too_large");
  if (!request.body) throw new Error("empty_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/** A digest only in a separate rate bucket. No link to a subscription or confession. */
export async function checkSubscribeRate(request: Request): Promise<boolean> {
  const address =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  const secret = process.env.PUSH_RATE_LIMIT_SECRET;
  if (!secret) throw new Error("Push rate limit is not configured");
  const bucket = createHmac("sha256", secret).update(address.trim()).digest("hex");
  const { data, error } = await supabaseAdmin.rpc("push_check_rate_limit", { _bucket: bucket });
  if (error) throw error;
  return data === true;
}

export async function saveSubscription(input: PushSubscriptionPayload): Promise<void> {
  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expiration_time:
        input.expirationTime === null ? null : new Date(input.expirationTime).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function requireAdmin(request: Request): Promise<string> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new Error("unauthorized");
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth.user) throw new Error("unauthorized");
  const { data: role, error } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !role) throw new Error("forbidden");
  return auth.user.id;
}

export async function countSubscriptions(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function sendBroadcast(
  payload: NotificationPayload,
  adminId: string,
): Promise<SendNotificationResult> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("VAPID is not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const total = await countSubscriptions();
  const { data: audit, error: auditError } = await supabaseAdmin
    .from("push_broadcast_audit")
    .insert({ admin_id: adminId, total })
    .select("id")
    .single();
  if (auditError || !audit) throw new Error("Could not start broadcast audit");
  const result: SendNotificationResult = {
    total,
    successful: 0,
    removedInvalid: 0,
    failedTemporary: 0,
  };
  const body = JSON.stringify(payload);
  // Keyset paging survives deletions of expired rows while the send is in progress.
  let after = "00000000-0000-0000-0000-000000000000";
  while (true) {
    const { data: rows, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .gt("id", after)
      .order("id")
      .limit(100);
    if (error) throw error;
    if (!rows?.length) break;
    after = rows[rows.length - 1].id;
    for (let i = 0; i < rows.length; i += 10) {
      await Promise.all(
        rows.slice(i, i + 10).map(async (row) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: row.endpoint,
                keys: {
                  p256dh: row.p256dh,
                  auth: row.auth,
                },
              },
              body,
              { TTL: 24 * 60 * 60, timeout: 10_000 },
            );
            result.successful++;
            await supabaseAdmin
              .from("push_subscriptions")
              .update({ last_success_at: new Date().toISOString() })
              .eq("id", row.id);
          } catch (cause) {
            const status =
              typeof cause === "object" && cause && "statusCode" in cause
                ? cause.statusCode
                : undefined;
            if (status === 404 || status === 410) {
              const { error: deleteError } = await supabaseAdmin
                .from("push_subscriptions")
                .delete()
                .eq("id", row.id);
              if (deleteError) result.failedTemporary++;
              else result.removedInvalid++;
            } else {
              result.failedTemporary++;
              await supabaseAdmin
                .from("push_subscriptions")
                .update({ last_failure_at: new Date().toISOString() })
                .eq("id", row.id);
            }
          }
        }),
      );
    }
  }
  const { error: completionError } = await supabaseAdmin
    .from("push_broadcast_audit")
    .update({
      completed_at: new Date().toISOString(),
      successful: result.successful,
      removed_invalid: result.removedInvalid,
      failed_temporary: result.failedTemporary,
    })
    .eq("id", audit.id);
  if (completionError) console.error("Push broadcast audit update failed");
  return result;
}
