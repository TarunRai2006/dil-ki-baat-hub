import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmissionList } from "@/components/admin/SubmissionList";
import { submissions, tiredOwl, toRow } from "../fixtures/data";

const rows = submissions.slice(0, 20).map(toRow);
const base = {
  rows,
  total: 45,
  page: 0,
  loading: false,
  fetching: false,
  error: false,
  filtered: false,
  newIds: new Set<string>(),
  onOpen: vi.fn(),
  onPage: vi.fn(),
  onRetry: vi.fn(),
};

describe("SubmissionList", () => {
  it("shows the row facts an admin scans for", () => {
    render(<SubmissionList {...base} />);
    const row = screen.getByRole("button", { name: /tired owl/i });
    expect(within(row).getByText("Career")).toBeInTheDocument();
    expect(within(row).getByText("I want advice")).toBeInTheDocument();
    expect(within(row).getByText(/2\/5 · Low/)).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
  });

  it("opens a submission on click", async () => {
    const onOpen = vi.fn();
    render(<SubmissionList {...base} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /tired owl/i }));
    expect(onOpen).toHaveBeenCalledWith(tiredOwl.id);
  });

  it("numbered pagination: range, current page, gaps on long lists", async () => {
    const onPage = vi.fn();
    render(<SubmissionList {...base} total={200} page={4} onPage={onPage} />);
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByText("81–100 of 200")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "5" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getAllByText("…")).toHaveLength(2);
    await userEvent.click(within(nav).getByRole("button", { name: /next/i }));
    expect(onPage).toHaveBeenCalledWith(5);
  });

  it("first page cannot go back; last page cannot go forward", () => {
    const { rerender } = render(<SubmissionList {...base} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    rerender(<SubmissionList {...base} page={2} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("marks newly arrived confessions", () => {
    render(<SubmissionList {...base} newIds={new Set([tiredOwl.id])} />);
    expect(
      within(screen.getByRole("button", { name: /tired owl/i })).getByText("New"),
    ).toBeInTheDocument();
  });

  it.each([
    [false, "No submissions found."],
    [true, "No submissions match your filters."],
  ])("empty state (filtered=%s)", (filtered, text) => {
    render(<SubmissionList {...base} rows={[]} total={0} filtered={filtered} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("error state offers a retry", async () => {
    const onRetry = vi.fn();
    render(<SubmissionList {...base} rows={undefined} error onRetry={onRetry} />);
    expect(screen.getByText(/unable to load submissions/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
