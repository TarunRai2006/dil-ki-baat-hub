import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FooterConfessionsCarousel } from "@/components/FooterConfessionsCarousel";
import { fetchWhispers } from "@/lib/confession";

vi.mock("@/lib/confession", () => ({ fetchWhispers: vi.fn() }));

const publicFeed = vi.mocked(fetchWhispers);

beforeEach(() => {
  publicFeed.mockReset();
  publicFeed.mockResolvedValue([]);
});

it("labels illustrative confessions when no approved public excerpts exist", async () => {
  const { container } = render(<FooterConfessionsCarousel />);

  expect(screen.getByRole("heading", { name: "Confessions" })).toBeInTheDocument();
  expect(screen.getByText(/not visitor submissions/i)).toBeInTheDocument();
  expect(container.querySelector('[data-confessions-source="examples"]')).not.toBeNull();
  await waitFor(() => expect(publicFeed).toHaveBeenCalledOnce());
});

it("uses only approved public excerpts when the public feed has them", async () => {
  publicFeed.mockResolvedValue(["An approved anonymous excerpt."]);
  const { container } = render(<FooterConfessionsCarousel />);

  await waitFor(() =>
    expect(container.querySelector('[data-confessions-source="approved"]')).not.toBeNull(),
  );
  expect(screen.getByText(/shared with permission and approved/i)).toBeInTheDocument();
  expect(screen.queryByText(/not visitor submissions/i)).not.toBeInTheDocument();
  expect(container.querySelectorAll("blockquote")).toHaveLength(12);
  expect(container.textContent).toContain("An approved anonymous excerpt.");
});
