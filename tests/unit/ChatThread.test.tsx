import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatLine, ConnectionState } from "@/hooks/use-room-chat";
import { messages, room } from "../fixtures/data";

const hook = {
  state: "connected" as ConnectionState,
  meta: null,
  lines: [] as ChatLine[],
  send: vi.fn<(t: string) => string | null>(() => null),
  retry: vi.fn(),
  lastSent: null as string | null,
};
vi.mock("@/hooks/use-room-chat", () => ({ useRoomChat: () => hook }));
const { ChatThread } = await import("@/components/ChatWidget");

beforeEach(() => {
  hook.state = "connected";
  hook.lines = [];
  hook.lastSent = null;
  hook.send.mockReset().mockReturnValue(null);
  hook.retry.mockReset();
});

describe("ChatThread", () => {
  it("empty room invites the visitor to start", () => {
    render(<ChatThread room={room} />);
    expect(screen.getByText(/you're in an anonymous room/i)).toBeInTheDocument();
    expect(screen.getByText(/start the conversation/i)).toBeInTheDocument();
  });

  it.each([
    ["connecting", /connecting…/i],
    ["connected", /^connected$/i],
    ["reconnecting", /reconnecting…/i],
    ["disconnected", /disconnected/i],
    ["expired", /room expired/i],
  ] as const)("shows the %s state", (state, label) => {
    hook.state = state;
    render(<ChatThread room={room} />);
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });

  it("renders messages as plain text, never HTML", () => {
    hook.lines = [{ ...messages[0], message: "<img src=x onerror=alert(1)><b>bold</b>" }];
    const { container } = render(<ChatThread room={room} />);
    expect(screen.getByText("<img src=x onerror=alert(1)><b>bold</b>")).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("sends trimmed input and clears the box", async () => {
    const user = userEvent.setup();
    render(<ChatThread room={room} />);
    await user.type(screen.getByLabelText("Message"), "  hi there  {enter}");
    expect(hook.send).toHaveBeenCalledWith("  hi there  ");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("keeps the text and explains when the hook refuses it", async () => {
    hook.send.mockReturnValue("Messages can be up to 1000 characters.");
    const user = userEvent.setup();
    render(<ChatThread room={room} />);
    await user.type(screen.getByLabelText("Message"), "too much{enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/1000 characters/);
    expect(screen.getByLabelText("Message")).toHaveValue("too much");
  });

  it("a failed message offers retry", async () => {
    hook.lines = [{ ...messages[0], pending: "failed", error: "Message failed." }];
    const user = userEvent.setup();
    render(<ChatThread room={room} />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(hook.retry).toHaveBeenCalledWith(messages[0].client_msg_id);
  });

  it("an expired room disables input and offers to start again", async () => {
    hook.state = "expired";
    const onEnded = vi.fn();
    const user = userEvent.setup();
    render(<ChatThread room={room} onEnded={onEnded} />);
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    expect(screen.getByText(/disappeared as promised/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /write again/i }));
    expect(onEnded).toHaveBeenCalled();
  });
});
