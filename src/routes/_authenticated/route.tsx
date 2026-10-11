import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminSession } from "@/lib/admin";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // getUser() asks the auth server, so a forged or revoked session cannot pass
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

/** Leaves the protected area the moment the session ends (expiry, revoke, other tab). */
function AuthenticatedLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    adminSession.leaving = false;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_OUT" && session) return;
      qc.clear();
      if (!adminSession.leaving) toast("Admin session expired. Please sign in again.");
      void navigate({ to: "/auth" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, qc]);

  return <Outlet />;
}
