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

it("starts the footer strip on view and keeps it moving after ten seconds", () => {
  vi.useFakeTimers();
  let onIntersect: IntersectionObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        onIntersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );

  const { container } = render(<WhispersMarquee startOnView continuous />);
  expect(observe).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(10_000));
  expect(container.querySelector('[data-marquee="bottom"]')).not.toBeNull();

  act(() =>
    onIntersect?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(disconnect).toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(10_000));
  expect(container.querySelector('[data-marquee="bottom"]')).not.toBeNull();
  expect(container.querySelectorAll(".header-marquee-thought")).toHaveLength(20);
  act(() => vi.advanceTimersByTime(60_000));
  expect(container.querySelector('[data-marquee="bottom"]')).not.toBeNull();
});
