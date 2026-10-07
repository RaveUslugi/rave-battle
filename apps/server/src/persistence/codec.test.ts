import { describe, expect, test } from "bun:test";
import { banFromDate, banToDate, bytesToOwners, ownersToBytes, PERMANENT_BAN_DATE } from "./codec";

describe("owners codec", () => {
  test("round-trips an Int32Array through bytes", () => {
    const owners = new Int32Array([0, 1, 7, 2_000_000_000]);
    const bytes = ownersToBytes(owners);
    expect(bytes.byteLength).toBe(16);
    expect(Array.from(bytesToOwners(bytes))).toEqual([0, 1, 7, 2_000_000_000]);
  });

  test("decoding copies, so the result does not alias the input", () => {
    const bytes = ownersToBytes(new Int32Array([5]));
    const owners = bytesToOwners(bytes);
    bytes[0] = 9;
    expect(owners[0]).toBe(5);
  });

  test("decoding rejects a length that is not a multiple of 4", () => {
    expect(() => bytesToOwners(new Uint8Array(6))).toThrow();
  });

  test("decodes a view that starts mid-buffer", () => {
    const backing = new Uint8Array(12);
    backing.set(ownersToBytes(new Int32Array([7, 8])), 4);
    expect(Array.from(bytesToOwners(backing.subarray(4)))).toEqual([7, 8]);
  });
});

describe("ban codec", () => {
  test("null stays null", () => {
    expect(banToDate(null)).toBeNull();
    expect(banFromDate(null)).toBeNull();
  });

  test("a timed ban round-trips", () => {
    const until = Date.UTC(2026, 9, 10);
    expect(banFromDate(banToDate(until))).toBe(until);
  });

  test("a permanent ban is stored as 9999-12-31 and read back as Infinity", () => {
    expect(banToDate(Number.POSITIVE_INFINITY)).toEqual(PERMANENT_BAN_DATE);
    expect(banFromDate(PERMANENT_BAN_DATE)).toBe(Number.POSITIVE_INFINITY);
  });
});
