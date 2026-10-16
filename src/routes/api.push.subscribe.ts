import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { subscriptionSchema } from "@/lib/push-shared";

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { publicKey: process.env.VAPID_PUBLIC_KEY ?? "" },
          {
            headers: { "Cache-Control": "no-store" },
          },
        ),
      POST: async ({ request }) => {
        const { sameOrigin, limitedBody, checkSubscribeRate, saveSubscription } =
          await import("@/lib/push-server.server");
        if (!sameOrigin(request)) return Response.json({ success: false }, { status: 403 });
        let body: unknown;
        try {
          body = await limitedBody(request);
        } catch {
          return Response.json({ success: false }, { status: 400 });
        }
        try {
          const input = subscriptionSchema.safeParse(body);
          if (!input.success) return Response.json({ success: false }, { status: 400 });
          if (!(await checkSubscribeRate(request)))
            return Response.json({ success: false }, { status: 429 });
          await saveSubscription(input.data);
          return Response.json({ success: true });
        } catch {
          return Response.json({ success: false }, { status: 503 });
        }
      },
    },
  },
});
