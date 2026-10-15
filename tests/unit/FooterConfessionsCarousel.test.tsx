import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FooterConfessionsCarousel } from "@/components/FooterConfessionsCarousel";

it("keeps the original example confessions in a thin footer ticker", () => {
  vi.useFakeTimers();
  const { container } = render(<FooterConfessionsCarousel />);

  expect(screen.getByText("Confessions · examples")).toBeInTheDocument();
  expect(screen.getByText(/not visitor submissions/i)).toBeInTheDocument();
  expect(container.querySelector('[data-confessions-source="examples"]')).not.toBeNull();
  expect(container.querySelectorAll(".footer-confessions-track span")).toHaveLength(12);
  expect(container.textContent).toContain("Someone in Delhi just released");
  act(() => vi.advanceTimersByTime(60_000));
  expect(container.querySelector(".footer-confessions-track")).not.toBeNull();
  vi.useRealTimers();
});
