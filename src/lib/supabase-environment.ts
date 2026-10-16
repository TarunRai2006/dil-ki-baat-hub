type Environment = Record<string, string | undefined>;

const REQUIRED = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
] as const;

function value(env: Environment, name: string): string {
  const result = env[name]?.trim() ?? "";
  if (!result || /<[^>]+>/.test(result)) {
    throw new Error(`[Supabase config] ${name} is missing or still a placeholder.`);
  }
  return result;
}

function apiUrl(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[Supabase config] ${name} must be a valid Supabase API URL.`);
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      `[Supabase config] ${name} must be an HTTPS API origin (HTTP is allowed only on loopback).`,
    );
  }
  return url;
}

/** Runs before Vite starts and again at the server entry, before any request is handled. */
export function assertSupabaseEnvironment(env: Environment): void {
  for (const name of REQUIRED) value(env, name);

  const browserUrl = apiUrl(value(env, "VITE_SUPABASE_URL"), "VITE_SUPABASE_URL");
  const serverUrl = apiUrl(value(env, "SUPABASE_URL"), "SUPABASE_URL");
  if (browserUrl.origin !== serverUrl.origin) {
    throw new Error(
      "[Supabase config] Browser and server Supabase URLs target different projects.",
    );
  }
  if (value(env, "VITE_SUPABASE_PUBLISHABLE_KEY") !== value(env, "SUPABASE_PUBLISHABLE_KEY")) {
    throw new Error("[Supabase config] Browser and server publishable keys differ.");
  }

  const browserId = env.VITE_SUPABASE_PROJECT_ID?.trim();
  const serverId = env.SUPABASE_PROJECT_ID?.trim();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(browserUrl.hostname);
  if (!local || browserId || serverId) {
    const expected = value(env, "VITE_SUPABASE_PROJECT_ID");
    if (expected !== value(env, "SUPABASE_PROJECT_ID")) {
      throw new Error("[Supabase config] Browser and server project IDs differ.");
    }
    const hostedRef = /^([a-z0-9]+)\.supabase\.co$/.exec(browserUrl.hostname)?.[1];
    if (hostedRef && expected !== hostedRef) {
      throw new Error("[Supabase config] Project ID does not match the Supabase URL host.");
    }
  }
}
