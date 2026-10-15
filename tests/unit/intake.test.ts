import { describe, expect, it } from "vitest";
import { CONTENT_MAX } from "@/lib/confession";
import {
  FEELINGS_MAX,
  MAX_COMPOSED_STORY,
  SUPPORT_MAX,
  STORY_MAX,
  composeStory,
} from "@/lib/intake";

describe("intake answers", () => {
  it("keeps the original story plain when follow-ups are skipped", () => {
    expect(
      composeStory({
        story: "  My story.  ",
        feelings: "",
        support: "",
      }),
    ).toBe("My story.");
  });

  it("fits every answer at its maximum length within the database story limit", () => {
    expect(MAX_COMPOSED_STORY).toBeLessThanOrEqual(CONTENT_MAX);
    expect(
      composeStory({
        story: "x".repeat(STORY_MAX),
        feelings: "x".repeat(FEELINGS_MAX),
        support: "x".repeat(SUPPORT_MAX),
      }).length,
    ).toBeLessThanOrEqual(CONTENT_MAX);
  });
});
