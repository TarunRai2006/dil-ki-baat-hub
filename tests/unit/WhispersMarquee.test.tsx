import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WhispersMarquee } from "@/components/WhispersMarquee";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows ten illustrative thoughts for ten seconds, then removes the strip", () => {
  vi.useFakeTimers();
  const { container } = render(<WhispersMarquee />);
  expect(container.querySelectorAll(".header-marquee-thought")).toHaveLength(10);
  expect(container.textContent).toContain("I miss who I used to be.");

  act(() => vi.advanceTimersByTime(9_999));
  expect(container.querySelector(".header-marquee")).not.toBeNull();

  act(() => vi.advanceTimersByTime(1));
  expect(container.querySelector(".header-marquee")).toBeNull();
});
