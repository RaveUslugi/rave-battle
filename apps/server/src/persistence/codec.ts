/** Permanent bans are stored as this date and read back as Infinity. */
export const PERMANENT_BAN_DATE = new Date("9999-12-31T00:00:00.000Z");

/** Raw bytes of the owners array (platform byte order). */
export function ownersToBytes(owners: Int32Array): Uint8Array {
  return new Uint8Array(owners.buffer, owners.byteOffset, owners.byteLength);
}

export function bytesToOwners(bytes: Uint8Array): Int32Array {
  const copy = bytes.slice();
  return new Int32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function banToDate(bannedUntil: number | null): Date | null {
  if (bannedUntil === null) return null;
  return Number.isFinite(bannedUntil) ? new Date(bannedUntil) : PERMANENT_BAN_DATE;
}

export function banFromDate(date: Date | null): number | null {
  if (date === null) return null;
  return date.getTime() >= PERMANENT_BAN_DATE.getTime() ? Number.POSITIVE_INFINITY : date.getTime();
}
