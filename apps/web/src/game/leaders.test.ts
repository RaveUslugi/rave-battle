import { describe, expect, test } from "bun:test";
import { BOARDS, periodsFor } from "./leaders";

describe("leaders", () => {
  test("territory has no period choice", () => {
    expect(periodsFor("territory")).toEqual([]);
    expect(periodsFor("artists")).toEqual(["day", "week", "all"]);
  });

  test("boards in display order", () => {
    expect(BOARDS.map((b) => b.board)).toEqual(["artists", "bombers", "sappers", "kamikaze", "territory"]);
  });
});
