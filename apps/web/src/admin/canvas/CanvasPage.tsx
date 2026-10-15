import { normalizeRect, type Rect } from "@rave/shared/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasSession } from "../../canvas/session";
import { GameClient, moderationFrame } from "../../game/client";
import { useTranslation } from "../../i18n";
import { toolsApi } from "../../net/api";
import { gameStore } from "../../state/game-store";
import { readingsStore } from "../../state/readings-store";
import { uiStore, useUi } from "../../state/ui-store";
import { IconButton, Segmented } from "../../ui/kit";
import c from "./canvas.module.css";
import { CanvasPanel } from "./CanvasPanel";

const ZOOM_STEP = 1.5;
const isAdminTool = (tool: string) => tool === "inspect" || tool === "area";

/** "380,300,499,359" → a rectangle, or null. */
export function parseArea(value: string | null): Rect | null {
  const nums = value?.split(",").map(Number);
  if (!nums || nums.length !== 4 || !nums.every((n) => Number.isInteger(n) && n >= 0)) return null;
  return normalizeRect({ x: nums[0]!, y: nums[1]! }, { x: nums[2]!, y: nums[3]! });
}

/**
 * The game's canvas, read-only: the same session and client as the game, but the only tools are the
 * inspector and the area, so a tap never paints. The panel on the right acts on what is picked.
 */
export default function CanvasPage() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<CanvasSession | null>(null);
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore, readings: readingsStore, tools: toolsApi }), []);
  const tool = useUi((s) => s.tool);

  useEffect(() => {
    // Only the admin tools here: the client resets the tool to the brush on login, so keep putting it back.
    const keep = () => {
      const ui = uiStore.getState();
      if (ui.tool !== "inspect" && ui.tool !== "area") ui.setTool("inspect");
    };
    keep();
    const area = parseArea(new URLSearchParams(window.location.search).get("area"));
    if (area) uiStore.getState().setArea(area);
    return uiStore.subscribe(keep);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const s: CanvasSession = new CanvasSession(el, {
      // Never paint from the admin page, whatever the tool says.
      onCellTap: (cell, pointerType) => isAdminTool(uiStore.getState().tool) && client.onCellTap(cell, pointerType),
      areaDrag: (pointerType) => pointerType === "mouse" && uiStore.getState().tool === "area",
      onAreaDrag: (a, b, done) => {
        if (done) uiStore.getState().setArea(normalizeRect(a, b));
        else s.setArea(normalizeRect(a, b));
      },
      onAreaDragEnd: () => s.setArea(moderationFrame(uiStore.getState().moderation)),
    });
    client.attach(s);
    setSession(s);
    return () => {
      client.detach();
      s.dispose();
    };
  }, [client]);

  return (
    <div className={c.layout}>
      <div className={c.stage}>
        <div ref={host} className={c.host} />
        <div className={c.toolbar}>
          <Segmented
            label={t("admin.canvas.tools")}
            value={tool === "area" ? "area" : "inspect"}
            onChange={(v) => uiStore.getState().setTool(v)}
            options={[
              { value: "inspect", label: t("admin.canvas.inspect"), icon: "pointer" },
              { value: "area", label: t("admin.canvas.area"), icon: "area" },
            ]}
          />
          <IconButton icon="plus" label={t("admin.canvas.zoomIn")} onClick={() => session?.zoomBy(ZOOM_STEP)} />
          <IconButton icon="minus" label={t("admin.canvas.zoomOut")} onClick={() => session?.zoomBy(1 / ZOOM_STEP)} />
        </div>
      </div>
      <aside className={c.panel} aria-label={t("admin.nav.canvas")}>
        <CanvasPanel />
      </aside>
    </div>
  );
}
