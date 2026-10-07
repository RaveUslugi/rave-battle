import { decodeChunkBody } from "@rave/shared";

/** GET /chunk/:cx/:cy. `signal` lets the session abort loads still in flight when it is disposed. */
export async function fetchChunk(cx: number, cy: number, signal?: AbortSignal): Promise<{ version: number; colors: Uint8Array }> {
  const res = await fetch(`/chunk/${cx}/${cy}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`chunk ${cx}:${cy}: HTTP ${res.status}`);
  const body = decodeChunkBody(new Uint8Array(await res.arrayBuffer()));
  if (!body) throw new Error(`chunk ${cx}:${cy}: malformed body`);
  return body;
}
