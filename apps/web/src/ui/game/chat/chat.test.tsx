import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defaultConfig, type PlayerView, type TimelineEntry } from "@rave/shared";
import { act, fireEvent, render, within } from "@testing-library/react";
import { applyLocale } from "../../../i18n";
import { chatApi } from "../../../net/api";
import { gameStore } from "../../../state/game-store";
import { timelineStore } from "../../../state/timeline-store";
import { withDom } from "../../../test/dom";
import { ChatComposer, ChatFeed } from "./Chat";

withDom();
const screen = {
  get current() {
    return within(document.body);
  },
};

const player = (overrides: Partial<PlayerView> = {}): PlayerView => ({
  coins: 0,
  charges: 10,
  chargesUpdatedAt: 0,
  chargeCap: 10,
  frozenUntil: 0,
  inventory: { bomb: 0, detector: 0, defuser: 0 },
  unlockedColors: [],
  dailyStep: 0,
  dailyLastClaim: null,
  bannedUntil: null,
  blocks: [],
  banReason: null,
  playableAt: null,
  unlimited: false,
  chatMutedUntil: null,
  chatMuteReason: null,
  serverNow: Date.now(),
  ...overrides,
});

const message = (id: number, author = 2): TimelineEntry => ({
  type: "chat",
  id,
  author: { id: author, name: `user${author}` },
  text: `hello ${id}`,
  at: Date.now(),
});
const originalSend = chatApi.send;

beforeEach(() => {
  applyLocale("ru");
  gameStore.setState({ user: { id: 1, name: "me" }, player: player(), config: defaultConfig, clockOffset: 0, admin: false });
  timelineStore.setState({ items: [], unread: 0, viewing: false, showEvents: true });
});

afterEach(() => {
  chatApi.send = originalSend;
});

describe("ChatComposer", () => {
  test("a guest reads but is asked to log in to write", () => {
    gameStore.setState({ user: null, player: null });
    render(<ChatComposer />);
    expect(screen.current.getByText("Войдите, чтобы писать")).toBeTruthy();
    expect(screen.current.queryByRole("textbox")).toBeNull();
  });

  test("a muted player sees the reason instead of the field", () => {
    gameStore.setState({ player: player({ chatMutedUntil: "permanent", chatMuteReason: "спам" }) });
    render(<ChatComposer />);
    expect(screen.current.getByText("Вам отключили чат. Причина: спам")).toBeTruthy();
  });

  test("a refused message keeps its text and explains why under the field; a sent one clears it", async () => {
    let sent = "";
    chatApi.send = async (text) => {
      sent = text;
      return { ok: false, code: "cooldown", retryAt: Date.now() + 2500 };
    };
    render(<ChatComposer />);
    const input = screen.current.getByRole("textbox", { name: "Сообщение в чат" }) as HTMLInputElement;
    input.value = "привет";
    await act(async () => {
      fireEvent.submit(input.form!);
    });
    expect(sent).toBe("привет");
    expect(screen.current.getByRole("alert").textContent).toBe("Не так быстро — можно через 3 с");
    expect(input.value).toBe("привет");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    chatApi.send = async () => ({ ok: true, id: 7 });
    await act(async () => {
      fireEvent.submit(input.form!);
    });
    expect(input.value).toBe("");
    expect(screen.current.queryByRole("alert")).toBeNull();
  });
});

describe("ChatFeed", () => {
  test("follows new messages at the bottom; scrolled up, it counts them and offers to jump down", () => {
    timelineStore.getState().replace([message(1), message(2)]);
    render(<ChatFeed active />);
    const list = screen.current.getByRole("list");
    // happy-dom does no layout: pretend the list is taller than its box and scrolled to the top.
    Object.defineProperties(list, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 300, configurable: true } });
    list.scrollTop = 0;
    fireEvent.scroll(list);
    act(() => {
      timelineStore.getState().push(message(3), 1);
      timelineStore.getState().push(message(4, 1), 1);
    });
    const jump = screen.current.getByRole("button", { name: /2 новых/ });
    // Only the other player's message is unread.
    expect(timelineStore.getState().unread).toBe(1);
    fireEvent.click(jump);
    expect(screen.current.queryByRole("button", { name: /новых/ })).toBeNull();
    expect(timelineStore.getState()).toMatchObject({ viewing: true, unread: 0 });
  });

  test("events can be hidden; the admin gets a delete button on messages", () => {
    gameStore.setState({ admin: true });
    timelineStore.getState().replace([message(1), { type: "feed", kind: "exploded", actor: { id: 2, name: "bob" }, owner: { id: 3, name: "eve" }, at: 1 }]);
    render(<ChatFeed active />);
    expect(screen.current.getByText(/подорвался на бомбе/)).toBeTruthy();
    expect(screen.current.getAllByRole("button", { name: /^Удалить/ })).toHaveLength(1);
    act(() => timelineStore.getState().setShowEvents(false));
    expect(screen.current.queryByText(/подорвался на бомбе/)).toBeNull();
  });
});
