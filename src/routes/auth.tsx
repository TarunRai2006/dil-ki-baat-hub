import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { BrandLoader } from "@/components/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Counsellor & Therapist Sign In | Dil Ki Baat" },
      {
        name: "description",
        content:
          "Approved counsellors and therapists can sign in to review stories and reply to chats.",
      },
      { property: "og:title", content: "Counsellor & Therapist Sign In | Dil Ki Baat" },
      { property: "og:description", content: "Dil Ki Baat counsellor and therapist access." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

/** Human wording for Supabase Auth failures; never show raw auth errors. */
function authMessage(err: unknown, fallback: string): string {
  const raw = err && typeof err === "object" && "message" in err ? String(err.message) : "";
  if (/invalid login credentials/i.test(raw)) return "That email and password do not match.";
  if (/email not confirmed/i.test(raw))
    return "Confirm your email first: open the link we sent you (check spam too), then sign in.";
  if (/already registered|already been registered/i.test(raw))
    return "An account with this email already exists. Try signing in.";
  if (/password/i.test(raw) && /(least|short|weak)/i.test(raw))
    return "Please choose a longer, stronger password.";
  if (/rate limit|too many/i.test(raw))
    return "Too many attempts. Please wait a minute and try again.";
  if (/fetch|network/i.test(raw)) return "We could not reach the server. Check your connection.";
  return fallback;
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return toast.error(authMessage(error, "Sign in failed. Please try again."));
      await navigate({ to: "/admin" });
    } catch (err) {
      toast.error(authMessage(err, "Sign in failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/admin` },
      });
      if (error) return toast.error(authMessage(error, "Could not create the account."));
      // no session means the project wants the address confirmed before first sign-in
      if (!data.session)
        return toast.success(
          `Check ${email} for a confirmation link (look in spam too), then sign in here. An owner still has to grant dashboard access.`,
          { duration: 12_000 },
        );
      toast.success("Account created. An owner has to grant dashboard access before it opens.");
    } catch (err) {
      toast.error(authMessage(err, "Could not create the account."));
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) return toast.error("Google sign-in failed. Please try again.");
      if (result.redirected) return;
      await navigate({ to: "/admin" });
    } catch {
      toast.error("Google sign-in failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        <h1 className="text-center font-display text-4xl text-gradient-gold">
          Counsellor &amp; Therapist Access
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Only approved Dil Ki Baat counsellors and therapists can open the dashboard.
        </p>

        <div className="mt-8 rounded-2xl glass-panel p-6">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            {(["signin", "signup"] as const).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <form onSubmit={tab === "signin" ? signIn : signUp} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor={`${tab}-email`}>Email</Label>
                    <Input
                      id={`${tab}-email`}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${tab}-password`}>Password</Label>
                    <Input
                      id={`${tab}-password`}
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full gap-2" disabled={loading}>
                    {loading && <BrandLoader size="small" label="Signing in" />}
                    {tab === "signin" ? "Sign in" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            ))}
          </Tabs>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="secondary" className="w-full" onClick={google}>
            Continue with Google
          </Button>
        </div>
      </main>
    </div>
  );
}
