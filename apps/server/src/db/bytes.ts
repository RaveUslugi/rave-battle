import { customType } from "drizzle-orm/pg-core";

/** Postgres bytea as Uint8Array (drizzle-orm 0.45 has no built-in bytea). */
export const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
});
