import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { notificationSchema } from "@/lib/push-shared";

export const Route = createFileRoute("/api/push/admin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdmin, countSubscriptions } = await import("@/lib/push-server.server");
        try {
          await requireAdmin(request);
          return Response.json({ count: await countSubscriptions() });
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 403 });
        }
      },
      POST: async ({ request }) => {
        const { requireAdmin, sameOrigin, limitedBody, sendBroadcast } =
          await import("@/lib/push-server.server");
        if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
        let adminId: string;
        try {
          adminId = await requireAdmin(request);
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 403 });
        }
        let body: unknown;
        try {
          body = await limitedBody(request, 1024);
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        const input = notificationSchema.safeParse(body);
        if (!input.success)
          return Response.json({ error: "Invalid notification" }, { status: 400 });
        try {
          return Response.json(await sendBroadcast(input.data, adminId));
        } catch {
          return Response.json(
            { error: "Notification send failed. Check server configuration." },
            { status: 503 },
          );
        }
      },
    },
  },
});
