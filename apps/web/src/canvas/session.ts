import type { ServerMessage } from "@rave/shared";
import { browserTransport, GameSocket, socketUrl, type HelloMessage, type Timers } from "../net/socket";
import { gameStore } from "../state/game-store";
import { fetchChunk } from "./chunk-loader";
import { CanvasController } from "./controller";
import { PixiRenderer } from "./pixi-renderer";
import {
  cameraFromSearch,
  cameraToSearch,
  cellAt,
  clampCenter,
  fitZoom,
  MAX_ZOOM,
  pan,
  visibleChunks,
  zoomAt,
  type Camera,
  type CanvasSize,
  type ZoomLimits,
} from "./viewport";

export interface SessionCallbacks {
  /** A tap/click on a canvas cell (used by Plan 3b for placing). */
  onCellTap?(cell: { x: number; y: number }): void;
}

type Point = { x: number; y: number };

const TAP_MAX_MOVE = 5;
const TAP_MAX_MS = 400;
const SUBSCRIBE_THROTTLE_MS = 150;
const URL_DEBOUNCE_MS = 300;
const WHEEL_ZOOM_SPEED = 0.0015;
const WHEEL_LINE_PX = 16;

/** Owns the renderer, the socket and all pointer handling for one mounted canvas. */
export class CanvasSession {
  private readonly renderer = new PixiRenderer();
  private readonly socket: GameSocket;
  private readonly abort = new AbortController();
  private controller: CanvasController | null = null;
  private camera: Camera | null = null;
  private canvas: CanvasSize | null = null;
  private disposed = false;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pointers = new Map<number, Point>();
  private tapStart: (Point & { at: number }) | null = null;
  private moved = false;
  private readonly resizeObserver: ResizeObserver;

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
    // No-op while init is still pending; start() destroys it once init resolves.
    this.renderer.destroy();
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
    else if (message.type === "online") store.setOnline(message.count);
    else if (message.type === "subscribed") this.controller?.onAck(message.chunks);
    // "placed" and "feed" are handled in Plan 3b.
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
      if (this.camera && !this.disposed) window.history.replaceState(window.history.state, "", cameraToSearch(this.camera));
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
        this.tapStart = { ...point, at: performance.now() };
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
        if (this.moved) this.camera = pan(this.camera, point.x - previous.x, point.y - previous.y);
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
      if (event.type !== "pointerup" || this.moved || !tap || performance.now() - tap.at > TAP_MAX_MS) return;
      if (!this.camera || !this.canvas) return;
      const cell = cellAt(this.camera, this.renderer.screenSize(), tap.x, tap.y, this.canvas);
      if (cell) this.callbacks.onCellTap?.(cell);
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
        const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE;
        const pages = event.deltaMode === WheelEvent.DOM_DELTA_PAGE;
        const deltaY = event.deltaY * (lines ? WHEEL_LINE_PX : pages ? this.renderer.screenSize().h : 1);
        this.camera = zoomAt(this.camera, this.renderer.screenSize(), point.x, point.y, Math.exp(-deltaY * WHEEL_ZOOM_SPEED), this.zoomLimits(this.canvas));
        this.applyCamera();
        this.updateHover(point);
      },
      { passive: false },
    );
  }
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
