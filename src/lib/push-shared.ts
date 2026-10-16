import { z } from "zod";

const base64Url = /^[A-Za-z0-9_-]+$/;
const pushHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
];

export const subscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .min(20)
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            (pushHosts.includes(url.hostname) ||
              (url.hostname === "jmt17.google.com" && url.pathname.startsWith("/fcm/send/")) ||
              /^wns[0-9]*\.notify\.windows\.com$/.test(url.hostname))
          );
        } catch {
          return false;
        }
      }, "Unsupported push endpoint"),
    expirationTime: z
      .number()
      .int()
      .positive()
      .max(8_640_000_000_000_000)
      .nullable()
      .refine((value) => value === null || value > Date.now(), "Expired subscription"),
    keys: z
      .object({
        p256dh: z.string().min(80).max(120).regex(base64Url),
        auth: z.string().min(16).max(64).regex(base64Url),
      })
      .strict(),
  })
  .strict();

export const notificationSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(240),
    url: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.startsWith("//") &&
          !/[\\\r\n]/.test(value) &&
          !/^\/(?:api|auth|admin)(?:\/|$)/i.test(value),
        "Use a public same-origin path",
      ),
  })
  .strict();

export type PushSubscriptionPayload = z.infer<typeof subscriptionSchema>;
export type NotificationPayload = z.infer<typeof notificationSchema>;
export type SendNotificationResult = {
  total: number;
  successful: number;
  removedInvalid: number;
  failedTemporary: number;
};
