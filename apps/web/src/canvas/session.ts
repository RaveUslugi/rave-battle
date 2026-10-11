import { encodePlace, normalizeRect, type PlaceMessage, type Rect, type ServerMessage } from "@rave/shared/client";
import type { CanvasPort } from "../game/client";
import { browserTransport, GameSocket, socketUrl, type HelloMessage, type Timers } from "../net/socket";
import { feedStore } from "../state/feed-store";
import { gameStore } from "../state/game-store";
import { readingsStore } from "../state/readings-store";
import { fetchChunk } from "./chunk-loader";
import { CanvasController } from "./controller";
import { PixiRenderer } from "./pixi-renderer";
import {
  cameraFromSearch,
  cellAt,
  clampCenter,
  fitZoom,
  MAX_ZOOM,
  mergeCameraSearch,
  pan,
  visibleChunks,
  wheelZoomFactor,
  zoomAt,
  type Camera,
  type CanvasSize,
  type ZoomLimits,
} from "./viewport";

export interface SessionCallbacks {
  /** A tap/click on a canvas cell. `pointerType` is "mouse", "pen" or "touch". */
  onCellTap?(cell: { x: number; y: number }, pointerType: string): void;
  /** True when a drag should select an area instead of panning (area tool with a mouse). */
  areaDrag?(pointerType: string): boolean;
  /** Reports the dragged rectangle corners; `done` on release. */
  onAreaDrag?(from: { x: number; y: number }, to: { x: number; y: number }, done: boolean): void;
  /** A drag ended without producing a rectangle (cancelled, capture lost or released off the canvas): restore the stored frame. */
  onAreaDragEnd?(): void;
  onPlaced?(message: Extract<ServerMessage, { type: "placed" }>): void;
}

type Point = { x: number; y: number };

const TAP_MAX_MOVE = 5;
const TAP_MAX_MS = 400;
const SUBSCRIBE_THROTTLE_MS = 150;
const URL_DEBOUNCE_MS = 300;

/** Owns the renderer, the socket and all pointer handling for one mounted canvas. */
export class CanvasSession implements CanvasPort {
  private readonly renderer = new PixiRenderer();
  private readonly socket: GameSocket;
  private readonly abort = new AbortController();
  private controller: CanvasController | null = null;
  private camera: Camera | null = null;
  private canvas: CanvasSize | null = null;
  private disposed = false;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private viewFrame: number | null = null;
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pointers = new Map<number, Point>();
  private tapStart: (Point & { at: number; pointerType: string }) | null = null;
  private moved = false;
  private areaPreview = false;
  private readonly resizeObserver: ResizeObserver;
  private unsubscribeReadings: (() => void) | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeJump: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: SessionCallbacks = {},
  ) {
    // Events are ignored once disposed: a StrictMode double mount must not let the dead session
    // overwrite the live one's status in the shared store.
    this.socket = new GameSocket(socketUrl(window.location), browserTransport, {
      hello: (m) => !this.disposed && this.onHello(m),
      message: (m) => !this.disposed && this.onMessage(m),
      delta: (d) => !this.disposed && this.controller?.onDelta(d),
      status: (s) => !this.disposed && gameStore.getState().setStatus(s),
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.resize();
      this.applyCamera();
    });
    void this.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socket.close();
    this.abort.abort();
    this.resizeObserver.disconnect();
    if (this.viewTimer) clearTimeout(this.viewTimer);
    if (this.urlTimer) clearTimeout(this.urlTimer);
    this.viewTimer = this.urlTimer = null;
    if (this.viewFrame !== null) cancelAnimationFrame(this.viewFrame);
    this.unsubscribeReadings?.();
    this.unsubscribeJump?.();
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    // No-op while init is still pending; start() destroys it once init resolves.
    this.renderer.destroy();
  }

  sendPlace(message: Omit<PlaceMessage, "op">): boolean {
    return this.socket.send(encodePlace(message));
  }

  setPending(cells: Array<{ x: number; y: number; colorId: number }>): void {
    this.renderer.setPending(cells);
  }

  setSelection(cell: { x: number; y: number } | null): void {
    this.renderer.setSelection(cell);
  }

  setArea(rect: Rect | null): void {
    this.renderer.setArea(rect);
  }

  flash(cell: { x: number; y: number }): void {
    this.renderer.flash(cell);
  }

  private async start(): Promise<void> {
    try {
      await this.renderer.init(this.host);
    } catch (error) {
      console.error("Canvas renderer failed to start", error);
      if (!this.disposed) gameStore.getState().setStatus("closed");
      return;
    }
    if (this.disposed) {
      this.renderer.destroy();
      return;
    }
    // Controller timers stop firing after dispose, so retry/timeout loops for failed loads end with the session.
    const timers: Timers = {
      set: (fn, ms) => setTimeout(() => !this.disposed && fn(), ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.controller = new CanvasController({
      renderer: this.renderer,
      loadChunk: (cx, cy) => fetchChunk(cx, cy, this.abort.signal),
      socket: this.socket,
      timers,
    });
    this.unsubscribeJump = gameStore.subscribe((state, prev) => {
      if (!state.jump || state.jump === prev.jump || !this.camera) return;
      this.camera = { ...this.camera, x: state.jump.x + 0.5, y: state.jump.y + 0.5 };
      this.applyCamera();
    });
    this.renderer.setReadings(readingsStore.getState().readings);
    this.unsubscribeReadings = readingsStore.subscribe((state, prev) => {
      if (state.readings !== prev.readings) this.renderer.setReadings(state.readings);
    });
    // Fading depends on age: redraw now and then, and drop expired readings.
    this.fadeTimer = setInterval(() => {
      readingsStore.getState().prune();
      this.renderer.setReadings(readingsStore.getState().readings);
    }, 30_000);
    this.attachPointerHandlers(this.renderer.canvasElement);
    this.resizeObserver.observe(this.host);
    this.socket.connect();
  }

  private onHello(message: HelloMessage): void {
    gameStore.getState().applyHello(message);
    this.canvas = message.config.canvas;
    // Same boot (reconnect): the controller keeps its chunks, setVisible below sees no change and sends
    // nothing; GameSocket re-sends the stored subscription after this handler. New boot: the controller
    // drops everything and setVisible records the set, which GameSocket then sends once.
    this.controller?.onHello(message);
    this.applyCamera(true);
  }

  private onMessage(message: ServerMessage): void {
    const store = gameStore.getState();
    if (message.type === "player") store.setPlayer(message.player);
    else if (message.type === "config") {
      store.setConfig(message.config);
      this.canvas = message.config.canvas;
      this.controller?.onConfig(message.config);
      this.applyCamera(true);
    } else if (message.type === "online") store.setOnline(message.count);
    else if (message.type === "subscribed") this.controller?.onAck(message.chunks);
    else if (message.type === "placed") this.callbacks.onPlaced?.(message);
    else if (message.type === "feed") feedStore.getState().push(message);
    else if (message.type === "feed_history") feedStore.getState().replace(message.entries);
  }

  private zoomLimits(canvas: CanvasSize): ZoomLimits {
    return { min: fitZoom(canvas, this.renderer.screenSize()) / 2, max: MAX_ZOOM };
  }

  /** Clamps, renders and (throttled) updates subscriptions and the URL. */
  private applyCamera(immediateView = false): void {
    if (!this.canvas || !this.controller || this.disposed) return;
    const size = this.renderer.screenSize();
    // A zero-size host (hidden, not laid out yet) gives zoom 0 and NaN math; wait for a real size.
    if (size.w <= 0 || size.h <= 0) return;
    if (!this.camera) {
      // The first camera needs both the canvas size (from hello) and the screen size.
      this.camera = cameraFromSearch(window.location.search) ?? {
        x: this.canvas.width / 2,
        y: this.canvas.height / 2,
        zoom: fitZoom(this.canvas, size),
      };
      immediateView = true;
    }
    const limits = this.zoomLimits(this.canvas);
    const zoom = Math.min(limits.max, Math.max(limits.min, this.camera.zoom));
    this.camera = clampCenter({ ...this.camera, zoom }, this.canvas);
    this.renderer.setCamera(this.camera);
    // The minimap needs at most one update per frame; pointer events can fire more often.
    if (this.viewFrame === null) {
      this.viewFrame = requestAnimationFrame(() => {
        this.viewFrame = null;
        if (this.camera && !this.disposed) gameStore.getState().setView({ camera: this.camera, screen: this.renderer.screenSize() });
      });
    }

    if (immediateView) {
      if (this.viewTimer) clearTimeout(this.viewTimer);
      this.viewTimer = null;
      this.updateView();
    } else if (!this.viewTimer) {
      this.viewTimer = setTimeout(() => {
        this.viewTimer = null;
        this.updateView();
      }, SUBSCRIBE_THROTTLE_MS);
    }

    if (this.urlTimer) clearTimeout(this.urlTimer);
    this.urlTimer = setTimeout(() => {
      this.urlTimer = null;
      if (this.camera && !this.disposed) {
        window.history.replaceState(window.history.state, "", mergeCameraSearch(window.location.search, this.camera) + window.location.hash);
      }
    }, URL_DEBOUNCE_MS);
  }

  private updateView(): void {
    if (!this.camera || !this.canvas || !this.controller || this.disposed) return;
    this.controller.setVisible(visibleChunks(this.camera, this.renderer.screenSize(), this.canvas, 1));
  }

  private local(event: PointerEvent | WheelEvent): Point {
    const rect = this.renderer.canvasElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private updateHover(point: Point): void {
    if (!this.camera || !this.canvas) return;
    const cell = cellAt(this.camera, this.renderer.screenSize(), point.x, point.y, this.canvas);
    const current = gameStore.getState().hover;
    if (cell?.x !== current?.x || cell?.y !== current?.y) gameStore.getState().setHover(cell);
  }

  private dragCells(start: Point, end: Point): { from: Point; to: Point } | null {
    if (!this.camera || !this.canvas) return null;
    const screen = this.renderer.screenSize();
    const from = cellAt(this.camera, screen, start.x, start.y, this.canvas);
    const to = cellAt(this.camera, screen, end.x, end.y, this.canvas);
    return from && to ? { from, to } : null;
  }

  private attachPointerHandlers(element: HTMLCanvasElement): void {
    element.style.touchAction = "none";

    element.addEventListener("pointerdown", (event) => {
      // Mouse: only the primary button drags/taps.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone; tracking still works without capture.
      }
      const point = this.local(event);
      this.pointers.set(event.pointerId, point);
      if (this.pointers.size === 1) {
        this.tapStart = { ...point, at: performance.now(), pointerType: event.pointerType };
        this.moved = false;
      } else {
        // A second finger turns the gesture into a pinch: never a tap.
        this.tapStart = null;
        this.moved = true;
      }
    });

    element.addEventListener("pointermove", (event) => {
      const point = this.local(event);
      this.updateHover(point);
      const previous = this.pointers.get(event.pointerId);
      if (!previous || !this.camera) return;

      if (this.pointers.size === 1) {
        if (!this.moved && this.tapStart && Math.hypot(point.x - this.tapStart.x, point.y - this.tapStart.y) > TAP_MAX_MOVE) {
          this.moved = true;
        }
        if (this.moved && this.tapStart && this.callbacks.areaDrag?.(this.tapStart.pointerType)) {
          const cells = this.dragCells(this.tapStart, point);
          if (cells) {
            this.areaPreview = true;
            this.callbacks.onAreaDrag?.(cells.from, cells.to, false);
          }
        } else if (this.moved) this.camera = pan(this.camera, point.x - previous.x, point.y - previous.y);
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other && this.canvas) {
          const before = { mid: midpoint(previous, other), dist: distance(previous, other) };
          const after = { mid: midpoint(point, other), dist: distance(point, other) };
          // Zero distance (fingers on one spot) would give an infinite factor; zoomAt also rejects it.
          if (before.dist > 0 && after.dist > 0) {
            this.camera = zoomAt(this.camera, this.renderer.screenSize(), after.mid.x, after.mid.y, after.dist / before.dist, this.zoomLimits(this.canvas));
          }
          this.camera = pan(this.camera, after.mid.x - before.mid.x, after.mid.y - before.mid.y);
        }
      }
      this.pointers.set(event.pointerId, point);
      if (this.moved) this.applyCamera();
    });

    const release = (event: PointerEvent) => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.pointers.size > 0) return;
      const tap = this.tapStart;
      this.tapStart = null;
      const preview = this.areaPreview;
      this.areaPreview = false;
      if (event.type === "pointerup" && this.moved && tap && this.callbacks.areaDrag?.(tap.pointerType)) {
        const cells = this.dragCells(tap, this.local(event));
        if (cells) this.callbacks.onAreaDrag?.(cells.from, cells.to, true);
        else if (preview) this.callbacks.onAreaDragEnd?.();
        return;
      }
      if (preview) this.callbacks.onAreaDragEnd?.();
      if (event.type !== "pointerup" || this.moved || !tap || performance.now() - tap.at > TAP_MAX_MS) return;
      if (!this.camera || !this.canvas) return;
      const cell = cellAt(this.camera, this.renderer.screenSize(), tap.x, tap.y, this.canvas);
      if (cell) this.callbacks.onCellTap?.(cell, tap.pointerType);
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    // Without a pointerup (capture lost to the browser), the pointer must not stay "down" forever.
    element.addEventListener("lostpointercapture", release);
    element.addEventListener("pointerleave", () => {
      if (this.pointers.size === 0) gameStore.getState().setHover(null);
    });

    element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (!this.camera || !this.canvas) return;
        const point = this.local(event);
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode, this.renderer.screenSize().h);
        this.camera = zoomAt(this.camera, this.renderer.screenSize(), point.x, point.y, factor, this.zoomLimits(this.canvas));
        this.applyCamera();
        this.updateHover(point);
      },
      { passive: false },
    );
  }
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
