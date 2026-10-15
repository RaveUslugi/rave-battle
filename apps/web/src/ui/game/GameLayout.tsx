import { type CSSProperties, lazy, Suspense, useEffect } from "react";
import type { GameClient } from "../../game/client";
import { hotkeyAction, isTypingTarget, stepColor } from "../../game/hotkeys";
import { useIsDesktop, useWindowWidth } from "../../hooks/useViewport";
import { gameStore, useGame } from "../../state/game-store";
import { uiStore, useUi } from "../../state/ui-store";
import { ChunkBoundary } from "../ChunkBoundary";
import { ExplosionFlash } from "../ExplosionFlash";
import { ChatBlock, ChatTicker } from "./chat/Chat";
import { DesktopDock, MobileDock, pickTool, toggleBomb } from "./Dock";
import styles from "./layout.module.css";
import { CursorLabel, Notices } from "./Notices";
import { Rail, SectionsSheet, SidePanel, useOpenSection, usePanelRules } from "./Sections";
import { DesktopTopBar, MobileTopBar } from "./TopBar";
import { usePlayMode } from "./useGameState";

const CanvasView = lazy(() => import("../../canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const Minimap = lazy(() => import("../Minimap"));

const EDGE = 16;
const RAIL = 84;
/** Panel width plus the gap to the rail. */
const PANEL = 404;
const CHAT = 288 + 12;
const MINIMAP = 168 + 12;
/** Dock height (tools 70 + padding + frame) plus the gap above it. */
const DOCK_H = 94 + 12;
/** Tools, "+ bomb", dividers and padding; each palette column adds 24 px (up to 20 columns). */
const DOCK_FIXED = 332;

export interface DesktopGeometry {
  /** The canvas ends before the open panel. */
  canvasRight: number;
  dockLeft: number;
  dockRight: number;
  /** Bottom of the chat block and the minimap: beside the dock when it fits, above it otherwise. */
  sideBottom: number;
}

/**
 * Where the desktop pieces go. The dock sits between the chat and the minimap when the window is wide
 * enough; otherwise it takes the whole bottom and the chat and minimap move up above it.
 */
export function desktopGeometry(width: number, s: { panelOpen: boolean; minimapShown: boolean; colors: number }): DesktopGeometry {
  const right = RAIL + (s.panelOpen ? PANEL : 0);
  const dock = DOCK_FIXED + Math.min(20, s.colors) * 24;
  const inline = width - right - EDGE - CHAT - (s.minimapShown ? MINIMAP : 0) >= dock;
  return {
    canvasRight: s.panelOpen ? right + 12 - EDGE : 0,
    dockLeft: inline ? EDGE + CHAT : EDGE,
    dockRight: right + (inline && s.minimapShown ? MINIMAP : 0),
    sideBottom: inline ? EDGE : EDGE + DOCK_H,
  };
}

/** Desktop shortcuts; ignored while typing and while a dialog of its own (the sheet, a menu) handles Esc first. */
function useHotkeys(client: GameClient, enabled: boolean): void {
  const mode = usePlayMode();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
      const action = hotkeyAction(e);
      if (!action) return;
      const ui = uiStore.getState();
      const { player, config } = gameStore.getState();
      if (action.type === "escape") {
        if (ui.selection) client.cancelSelection();
        else if (ui.panel) ui.closePanel();
        else return;
      } else if (action.type === "color") {
        if (!config) return;
        const open = new Set(player?.unlockedColors ?? []);
        ui.selectColor(stepColor(config.palette, (p) => p.unlock === "default" || open.has(p.id), ui.selectedColor, action.step));
      } else {
        if (mode !== "play") return;
        const count = (item: "bomb" | "detector" | "defuser") => (!player || player.unlimited ? null : player.inventory[item]);
        if (action.type === "bomb") toggleBomb(count("bomb"));
        else if (action.tool === "detector" || action.tool === "defuser") pickTool(action.tool, count(action.tool));
        else pickTool("paint", null);
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client, enabled, mode]);
}

function Desktop({ client }: { client: GameClient }) {
  const panel = useOpenSection();
  const minimapOpen = useUi((s) => s.minimapOpen);
  return (
    <>
      <DesktopTopBar />
      <Notices />
      <Rail />
      <SidePanel />
      <ChatBlock />
      <ChunkBoundary fallback={null}>
        <Suspense fallback={null}>
          <Minimap open={minimapOpen && panel === null} className={styles.minimap} />
        </Suspense>
      </ChunkBoundary>
      <DesktopDock client={client} />
      <CursorLabel />
    </>
  );
}

function Mobile({ client }: { client: GameClient }) {
  return (
    <>
      <MobileTopBar />
      <ChatTicker />
      <Notices />
      <MobileDock client={client} />
      <SectionsSheet />
    </>
  );
}

/** The canvas under one of two layouts, picked by the window width; the canvas session survives the switch. */
export function GameLayout({ client }: { client: GameClient }) {
  const desktop = useIsDesktop();
  const width = useWindowWidth();
  const panel = useOpenSection();
  const minimapOpen = useUi((s) => s.minimapOpen);
  const colors = useGame((s) => s.config?.palette.length ?? 40);
  usePanelRules();
  useHotkeys(client, desktop);

  const panelOpen = desktop && panel !== null && panel !== "chat";
  const geo = desktopGeometry(width, { panelOpen, minimapShown: minimapOpen && !panelOpen, colors });
  const vars = desktop
    ? ({
        "--canvas-right": `${geo.canvasRight}px`,
        "--dock-left": `${geo.dockLeft}px`,
        "--dock-right": `${geo.dockRight}px`,
        "--side-bottom": `${geo.sideBottom}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div className={desktop ? styles.app : `${styles.app} ${styles.mobile}`} style={vars} data-layout={desktop ? "desktop" : "mobile"}>
      <div className={styles.canvasHost}>
        <ChunkBoundary fallback="reload">
          <Suspense fallback={null}>
            <CanvasView client={client} />
          </Suspense>
        </ChunkBoundary>
      </div>
      <ExplosionFlash />
      {desktop ? <Desktop client={client} /> : <Mobile client={client} />}
    </div>
  );
}
