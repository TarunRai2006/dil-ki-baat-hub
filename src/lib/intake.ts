import { CONTENT_MAX } from "@/lib/confession";

export const STORY_MAX = 1200;
export const FEELINGS_MAX = 300;
export const SUPPORT_MAX = 300;

export type IntakeAnswers = {
  story: string;
  feelings: string;
  support: string;
};

/** Keep all three answers readable in the existing private story field. */
export function composeStory(answers: IntakeAnswers): string {
  const sections = [answers.story.trim()];
  if (answers.feelings.trim()) {
    sections.push(
      `When does it feel hardest, and what have you tried?\n${answers.feelings.trim()}`,
    );
  }
  if (answers.support.trim()) {
    sections.push(`What would you like us to understand or help with?\n${answers.support.trim()}`);
  }
  return sections.join("\n\n");
}

// Reserve room for headings and separators in the database's 2,000-character field.
export const MAX_COMPOSED_STORY = composeStory({
  story: "x".repeat(STORY_MAX),
  feelings: "x".repeat(FEELINGS_MAX),
  support: "x".repeat(SUPPORT_MAX),
}).length;

if (MAX_COMPOSED_STORY > CONTENT_MAX) {
  throw new Error("The intake answers exceed the story limit.");
}
