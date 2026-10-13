import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("@/lib/audio-engine", () => ({ playClick: vi.fn(), playRelease: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const { ReleaseForm } = await import("@/components/city/ReleaseForm");

/** A controllable server: resolve/reject each submit_confession call by hand. */
let pending: { resolve: (v: unknown) => void }[] = [];
beforeEach(() => {
  pending = [];
  rpc.mockReset();
  rpc.mockImplementation(() => ({
    abortSignal: () => new Promise((resolve) => pending.push({ resolve })),
  }));
});
const ok = (room = true) => ({
  data: [
    {
      submission_id: "s1",
      alias: "Gumnam Dost #1",
      room_id: room ? "r1" : null,
      room_token: room ? "t".repeat(48) : null,
      room_expires_at: null,
    },
  ],
  error: null,
});

function setup() {
  const onReleased = vi.fn();
  const user = userEvent.setup();
  render(<ReleaseForm onReleased={onReleased} onPushStatus={vi.fn()} />);
  return { user, onReleased };
}
const textarea = () => screen.getByLabelText("What is on your mind?") as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: /let it go/i });

describe("ReleaseForm", () => {
  it("requires an age group and disables public sharing for 16–17", () => {
    setup();
    fireEvent.click(submit());
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 16/i);
    fireEvent.click(screen.getByRole("button", { name: "I am 16–17" }));
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maybe" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has every field of the confession", () => {
    setup();
    expect(textarea()).toBeInTheDocument();
    for (const label of [
      "Career",
      "I want advice",
      "Both",
      "Yes",
      "No",
      "Maybe",
      "Disappear in 1 hour",
    ])
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByLabelText("One question for the community")).toBeInTheDocument();
    expect(screen.getByLabelText("A name that is not yours")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/your private chat opens after you submit/i)).toBeInTheDocument();
  });

  it("pills expose their pressed state to assistive tech", async () => {
    const { user } = setup();
    const career = screen.getByRole("button", { name: "Career" });
    expect(career).toHaveAttribute("aria-pressed", "false");
    await user.click(career);
    expect(career).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Relationship" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("explains an empty submission without calling the server", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/one honest sentence/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a double click sends exactly one request and shows a busy state", async () => {
    const { user, onReleased } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    fireEvent.change(textarea(), {
      target: { value: "I have been pretending to be okay for months." },
    });
    const button = submit();
    await user.dblClick(button);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /letting go/i })).toBeDisabled();
    await act(async () => pending[0].resolve(ok()));
    expect(await screen.findByText(/your words have been received/i)).toBeInTheDocument();
    expect(onReleased).toHaveBeenCalledWith(
      "I have been pretending to be okay for months.",
      expect.objectContaining({ roomId: "r1" }),
    );
  });

  it("does not show success when the server omits the required room", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    fireEvent.change(textarea(), {
      target: { value: "Something honest and long enough to send." },
    });
    await user.click(submit());
    expect(screen.queryByText(/your words have been received/i)).not.toBeInTheDocument();
    await act(async () => pending[0].resolve(ok(false)));
    expect(await screen.findByRole("alert")).toHaveTextContent(/please refresh and try again/i);
    expect(screen.queryByText(/your words have been received/i)).not.toBeInTheDocument();
  });

  it("a failure keeps every typed word, explains kindly, and the retry reuses the request id", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    fireEvent.change(textarea(), {
      target: { value: "Words I do not want to lose to a network error." },
    });
    fireEvent.change(screen.getByLabelText("A name that is not yours"), {
      target: { value: "Tired Owl" },
    });
    await user.click(submit());
    await act(async () =>
      pending[0].resolve({
        data: null,
        error: { message: "PostgrestError: internal boom", code: "XX000" },
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong while sending your confession/i);
    expect(alert).not.toHaveTextContent(/postgrest|boom/i);
    expect(textarea().value).toBe("Words I do not want to lose to a network error.");
    expect(screen.getByLabelText("A name that is not yours")).toHaveValue("Tired Owl");

    await user.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1][1]._client_request_id).toBe(rpc.mock.calls[0][1]._client_request_id);
  });

  it("editing after a failure makes a new request id (a changed confession is a new one)", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    fireEvent.change(textarea(), { target: { value: "First version of what I wanted to say." } });
    await user.click(submit());
    await act(async () => pending[0].resolve({ data: null, error: { message: "boom" } }));
    await screen.findByRole("alert");
    fireEvent.change(textarea(), {
      target: { value: "First version of what I wanted to say. Edited." },
    });
    await user.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1][1]._client_request_id).not.toBe(
      rpc.mock.calls[0][1]._client_request_id,
    );
  });

  it("rate limiting reads as a human message", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "I am 18 or older" }));
    fireEvent.change(textarea(), { target: { value: "Another honest thought, long enough." } });
    await user.click(submit());
    await act(async () => pending[0].resolve({ data: null, error: { message: "rate_limited" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/take a breath/i);
  });
});
