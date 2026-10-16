import { describe, expect, it } from "vitest";
import { assertSupabaseEnvironment } from "@/lib/supabase-environment";

const local = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
};

const hosted = {
  ...local,
  VITE_SUPABASE_URL: "https://projectone.supabase.co",
  SUPABASE_URL: "https://projectone.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "projectone",
  SUPABASE_PROJECT_ID: "projectone",
};

describe("Supabase target guard", () => {
  it("accepts a complete local or hosted target", () => {
    expect(() => assertSupabaseEnvironment(local)).not.toThrow();
    expect(() => assertSupabaseEnvironment(hosted)).not.toThrow();
  });

  it.each([
    [{ ...local, SUPABASE_URL: "" }, /SUPABASE_URL is missing/],
    [{ ...local, VITE_SUPABASE_PUBLISHABLE_KEY: "<publishable key>" }, /placeholder/],
    [{ ...local, SUPABASE_URL: "https://other.supabase.co" }, /different projects/],
    [{ ...local, SUPABASE_PUBLISHABLE_KEY: "wrong" }, /keys differ/],
    [{ ...hosted, SUPABASE_PROJECT_ID: "othertarget" }, /project IDs differ/],
    [
      { ...hosted, VITE_SUPABASE_PROJECT_ID: "othertarget", SUPABASE_PROJECT_ID: "othertarget" },
      /does not match/,
    ],
    [{ ...hosted, VITE_SUPABASE_PROJECT_ID: "", SUPABASE_PROJECT_ID: "" }, /PROJECT_ID is missing/],
    [
      {
        ...hosted,
        VITE_SUPABASE_URL: "http://projectone.supabase.co",
        SUPABASE_URL: "http://projectone.supabase.co",
      },
      /HTTPS API origin/,
    ],
  ])("rejects missing or mismatched deployment values", (environment, message) => {
    expect(() => assertSupabaseEnvironment(environment)).toThrow(message);
  });
});
