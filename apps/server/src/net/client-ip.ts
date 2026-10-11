/**
 * Client address for rate limits. Behind our own proxy the TCP peer is the proxy, so the real address is the
 * last X-Forwarded-For entry — the one the proxy itself appended. Earlier entries come from the client and are ignored.
 */
export function clientIp(req: Request, peer: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const last = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return peer ?? "unknown";
}
