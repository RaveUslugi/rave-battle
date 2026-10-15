import { afterAll, afterEach, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Gives one test file a browser DOM (happy-dom) and removes it afterwards: registering it globally
 * would replace fetch and WebSocket for the server tests that share the process.
 * Call at the top level of a component test file, before rendering.
 */
export function withDom(): void {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost:5173/" });
  });
  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  });
}
