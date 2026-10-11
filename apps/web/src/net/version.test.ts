import { expect, test } from "bun:test";
import { onProtocolMismatch } from "./version";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("first mismatch reloads, a second within a minute asks, after a minute reloads again", () => {
  const storage = memory();
  expect(onProtocolMismatch(storage, 1_000_000)).toBe("reload");
  expect(onProtocolMismatch(storage, 1_030_000)).toBe("ask");
  expect(onProtocolMismatch(storage, 1_061_000)).toBe("reload");
});

test("without storage it always reloads", () => {
  expect(onProtocolMismatch(null, 1)).toBe("reload");
  expect(onProtocolMismatch(null, 2)).toBe("reload");
});
