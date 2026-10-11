import { expect, test } from "bun:test";
import { AccessQueue } from "./access-queue";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("jobs of one user run strictly one after another", async () => {
  const q = new AccessQueue();
  const log: string[] = [];
  const job = (name: string) => async () => {
    log.push(`${name}:start`);
    await tick();
    log.push(`${name}:end`);
  };
  await Promise.all([q.run(1, job("a")), q.run(1, job("b"))]);
  expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
});

test("different users run in parallel", async () => {
  const q = new AccessQueue();
  const log: string[] = [];
  const job = (name: string) => async () => {
    log.push(`${name}:start`);
    await tick();
    log.push(`${name}:end`);
  };
  await Promise.all([q.run(1, job("a")), q.run(2, job("b"))]);
  expect(log.slice(0, 2)).toEqual(["a:start", "b:start"]);
});

test("a failed job does not block the queue", async () => {
  const q = new AccessQueue();
  const failing = q.run(1, async () => {
    throw new Error("boom");
  });
  await expect(failing).rejects.toThrow("boom");
  expect(await q.run(1, async () => "ok")).toBe("ok");
});

test("nothing is left in the map once the jobs are done", async () => {
  const q = new AccessQueue();
  await Promise.all([q.run(1, async () => {}), q.run(1, async () => {}), q.run(2, async () => {})]);
  await tick();
  expect((q as unknown as { chains: Map<number, unknown> }).chains.size).toBe(0);
});
