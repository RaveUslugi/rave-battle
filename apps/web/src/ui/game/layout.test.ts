import { describe, expect, test } from "bun:test";
import { desktopGeometry } from "./GameLayout";
import { clock, segmentStates } from "./resources";
import { sectionAllowed } from "./Sections";
import { dayStates } from "./sections/DailySection";

describe("desktop geometry", () => {
  test("wide: the dock sits between the chat and the minimap, both at the bottom", () => {
    expect(desktopGeometry(1440, { panelOpen: false, minimapShown: true, colors: 48 })).toEqual({
      canvasRight: 0,
      dockLeft: 316,
      dockRight: 264,
      sideBottom: 16,
    });
  });

  test("narrower, or with the panel open: the dock takes the bottom and the chat moves up; the canvas ends before the panel", () => {
    expect(desktopGeometry(1280, { panelOpen: false, minimapShown: true, colors: 48 })).toMatchObject({ dockLeft: 16, dockRight: 84, sideBottom: 122 });
    expect(desktopGeometry(1440, { panelOpen: true, minimapShown: false, colors: 48 })).toEqual({
      canvasRight: 484,
      dockLeft: 16,
      dockRight: 488,
      sideBottom: 122,
    });
  });

  test("a short palette needs less room", () => {
    expect(desktopGeometry(1280, { panelOpen: false, minimapShown: false, colors: 16 }).sideBottom).toBe(16);
  });
});

describe("charges", () => {
  test("segments: full, the one regenerating next, empty", () => {
    expect(segmentStates(2, 4, true)).toEqual(["full", "full", "next", "empty"]);
    expect(segmentStates(2, 4, false)).toEqual(["full", "full", "empty", "empty"]);
    expect(segmentStates(4, 4, false)).toEqual(["full", "full", "full", "full"]);
  });

  test("clock rounds up to whole seconds", () => {
    expect(clock(17_200)).toBe("0:18");
    expect(clock(725_000)).toBe("12:05");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("daily", () => {
  test("days before today in the loop are taken, today is marked, the rest are ahead", () => {
    expect(dayStates(7, 2, false)).toEqual(["done", "done", "today", "future", "future", "future", "future"]);
    // Today's reward is taken: the next one (step 3) is tomorrow's.
    expect(dayStates(7, 3, true)).toEqual(["done", "done", "today", "future", "future", "future", "future"]);
    // The loop wrapped: today's was the last day.
    expect(dayStates(7, 0, true)[6]).toBe("today");
  });
});

describe("sections", () => {
  const guest = { loggedIn: false, admin: false, otherProfile: false };
  test("guests see the chat, the rankings and other players' profiles; moderation is for admins", () => {
    expect(["chat", "leaders"].every((p) => sectionAllowed(p as "chat", guest))).toBe(true);
    expect(["shop", "daily", "profile", "moderation"].some((p) => sectionAllowed(p as "shop", guest))).toBe(false);
    expect(sectionAllowed("profile", { ...guest, otherProfile: true })).toBe(true);
    expect(sectionAllowed("moderation", { loggedIn: true, admin: false, otherProfile: false })).toBe(false);
    expect(sectionAllowed("moderation", { loggedIn: true, admin: true, otherProfile: false })).toBe(true);
  });
});
