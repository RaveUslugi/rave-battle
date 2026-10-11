import type { PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { effectiveAccess } from "./access";

const NOW = 2_000_000;
type AccessFields = Pick<PlayerView, "blocks" | "bannedUntil" | "playableAt">;
const view = (overrides: Partial<AccessFields>): AccessFields => ({ blocks: [], bannedUntil: null, playableAt: null, ...overrides });

describe("effectiveAccess", () => {
  test("an expired ban no longer refuses", () => {
    expect(effectiveAccess(view({ blocks: ["banned"], bannedUntil: NOW }), NOW)).toBe("ok");
    expect(effectiveAccess(view({ blocks: ["banned"], bannedUntil: NOW + 1 }), NOW)).toBe("banned");
  });

  test("an expired ban falls through to the next block", () => {
    expect(effectiveAccess(view({ blocks: ["banned", "not_guild_member"], bannedUntil: NOW }), NOW)).toBe("not_guild_member");
  });

  test("a permanent ban stays", () => {
    expect(effectiveAccess(view({ blocks: ["banned"], bannedUntil: "permanent" }), NOW)).toBe("banned");
  });

  test("an account that has grown old enough may play", () => {
    expect(effectiveAccess(view({ blocks: ["account_too_new"], playableAt: NOW }), NOW)).toBe("ok");
    expect(effectiveAccess(view({ blocks: ["account_too_new"], playableAt: NOW + 1 }), NOW)).toBe("account_too_new");
  });

  test("other reasons are kept", () => {
    expect(effectiveAccess(view({ blocks: ["not_guild_member"] }), NOW)).toBe("not_guild_member");
    expect(effectiveAccess(view({}), NOW)).toBe("ok");
  });
});
