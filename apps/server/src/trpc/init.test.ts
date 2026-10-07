import { expect, test } from "bun:test";
import { TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { formatError } from "./init";

const shape = { message: "boom: secret detail", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } as TRPCDefaultErrorShape;
const error = (code: TRPCError["code"]) => new TRPCError({ code, message: "boom: secret detail" });

test("internal errors get a generic message in production", () => {
  const out = formatError({ shape, error: error("INTERNAL_SERVER_ERROR") }, false);
  expect(out).toEqual({ ...shape, message: "Internal server error" });
});

test("other errors are left alone in production", () => {
  expect(formatError({ shape, error: error("BAD_REQUEST") }, false)).toBe(shape);
});

test("internal errors keep their message in dev", () => {
  expect(formatError({ shape, error: error("INTERNAL_SERVER_ERROR") }, true)).toBe(shape);
});
