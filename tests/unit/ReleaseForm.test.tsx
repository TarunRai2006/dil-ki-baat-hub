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
  render(<ReleaseForm onReleased={onReleased} />);
  return { user, onReleased };
}
const textarea = () =>
  screen.getByLabelText("What happened, and what feels hardest right now?") as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: /let it go/i });

describe("ReleaseForm", () => {
  it("shows submission consent in one sentence without an age selector or checkbox", () => {
    setup();
    fireEvent.click(submit());
    expect(screen.getByRole("alert")).toHaveTextContent(/one honest sentence/i);
    expect(screen.queryByRole("button", { name: "I am 16–17" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maybe" })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/by submitting, you confirm you are at least 16/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument();
  });

  it("shows three written prompts, two reply choices and no extra questions", () => {
    setup();
    expect(textarea()).toBeInTheDocument();
    expect(
      screen.getByLabelText("When does it feel hardest, and what have you tried?"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("What would you like us to understand or help with?"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA")).toHaveLength(
      3,
    );
    expect(screen.getByRole("button", { name: "Relationship" })).toBeInTheDocument();
    expect(
      screen.queryByLabelText("One question for your counsellor or therapist"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("A name that is not yours")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disappear in 1 hour" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Both" })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "How heavy is today?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I want to be heard" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Not chosen")).toBeInTheDocument();
    expect(
      screen.queryByText(/your private chat opens in this browser after you submit/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/a quick check-in/i)).not.toBeInTheDocument();
  });

  it("sends all three answers in readable fields", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), { target: { value: "I am struggling with school." } });
    fireEvent.change(screen.getByLabelText("When does it feel hardest, and what have you tried?"), {
      target: { value: "I cannot focus and have tried taking breaks." },
    });
    fireEvent.change(screen.getByLabelText("What would you like us to understand or help with?"), {
      target: { value: "Please listen before suggesting what to do." },
    });
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
    await user.click(submit());

    expect(rpc).toHaveBeenCalledTimes(1);
    const payload = rpc.mock.calls[0][1];
    expect(payload._content).toContain("I am struggling with school.");
    expect(payload._content).toContain(
      "When does it feel hardest, and what have you tried?\nI cannot focus and have tried taking breaks.",
    );
    expect(payload._content).toContain(
      "What would you like us to understand or help with?\nPlease listen before suggesting what to do.",
    );
    expect(Object.keys(payload).sort()).toEqual([
      "_anon_user_id",
      "_category",
      "_chat_ttl",
      "_client_request_id",
      "_community_question",
      "_consent_confirmed",
      "_content",
      "_emotional_state",
      "_intent",
      "_nickname",
    ]);
    expect(payload._category).toBeNull();
    expect(payload._intent).toBe("Express");
    expect(payload._emotional_state).toBeNull();
    expect(payload._chat_ttl).toBe("never");
  });

  it("shows duration for advice and sends no expiry for heard", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), { target: { value: "I need a quiet place to talk today." } });
    await user.click(screen.getByRole("button", { name: "Career" }));
    fireEvent.change(screen.getByRole("slider", { name: "How heavy is today?" }), {
      target: { value: "2" },
    });
    await user.click(screen.getByRole("button", { name: "I want advice" }));
    await user.click(screen.getByRole("button", { name: "Disappear in 1 hour" }));
    expect(screen.getByText("2/5 · Low")).toBeInTheDocument();
    await user.click(submit());
    expect(rpc.mock.calls[0][1]).toMatchObject({
      _category: "Career",
      _emotional_state: 2,
      _intent: "Advice",
      _community_question: "",
      _nickname: "",
      _chat_ttl: "1h",
    });

    await act(async () => pending[0].resolve({ data: null, error: { message: "network down" } }));
    await user.click(screen.getByRole("button", { name: "Clear rating" }));
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
    expect(screen.queryByRole("button", { name: "Disappear in 1 hour" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Career" }));
    await user.click(submit());
    expect(rpc.mock.calls[1][1]).toMatchObject({
      _category: null,
      _emotional_state: null,
      _intent: "Express",
      _chat_ttl: "never",
    });
    expect(rpc.mock.calls[1][1]._client_request_id).not.toBe(
      rpc.mock.calls[0][1]._client_request_id,
    );
  });

  it("explains an empty submission without calling the server", async () => {
    const { user } = setup();
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/one honest sentence/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for a reply choice before sending a written story", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), {
      target: { value: "I need to tell someone what happened today." },
    });
    await user.click(submit());
    expect(screen.getByRole("alert")).toHaveTextContent(
      /whether you want advice or simply to be heard/i,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a double click sends exactly one request and shows a busy state", async () => {
    const { user, onReleased } = setup();
    fireEvent.change(textarea(), {
      target: { value: "I have been pretending to be okay for months." },
    });
    await user.click(screen.getByRole("button", { name: "I want advice" }));
    const button = submit();
    await user.dblClick(button);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /letting go/i })).toBeDisabled();
    await act(async () => pending[0].resolve(ok()));
    expect(await screen.findByText("Congratulations!!!!!")).toBeInTheDocument();
    expect(screen.getByText("You let it go.")).toBeInTheDocument();
    expect(screen.getByText(/a verified counsellor or therapist/i)).toBeInTheDocument();
    expect(onReleased).toHaveBeenCalledWith(
      "I have been pretending to be okay for months.",
      expect.objectContaining({ roomId: "r1" }),
      "Advice",
    );
  });

  it("does not show success when the server omits the required room", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), {
      target: { value: "Something honest and long enough to send." },
    });
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
    await user.click(submit());
    expect(screen.queryByText("Congratulations!!!!!")).not.toBeInTheDocument();
    await act(async () => pending[0].resolve(ok(false)));
    expect(await screen.findByRole("alert")).toHaveTextContent(/please refresh and try again/i);
    expect(screen.queryByText("Congratulations!!!!!")).not.toBeInTheDocument();
  });

  it("a failure keeps every typed word, explains kindly, and the retry reuses the request id", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), {
      target: { value: "Words I do not want to lose to a network error." },
    });
    fireEvent.change(screen.getByLabelText("What would you like us to understand or help with?"), {
      target: { value: "Please give me time to explain." },
    });
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
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
    expect(screen.getByLabelText("What would you like us to understand or help with?")).toHaveValue(
      "Please give me time to explain.",
    );

    await user.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1][1]._client_request_id).toBe(rpc.mock.calls[0][1]._client_request_id);
  });

  it("editing after a failure makes a new request id (a changed confession is a new one)", async () => {
    const { user } = setup();
    fireEvent.change(textarea(), { target: { value: "First version of what I wanted to say." } });
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
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
    fireEvent.change(textarea(), { target: { value: "Another honest thought, long enough." } });
    await user.click(screen.getByRole("button", { name: "I want to be heard" }));
    await user.click(submit());
    await act(async () => pending[0].resolve({ data: null, error: { message: "rate_limited" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/take a breath/i);
  });
});
