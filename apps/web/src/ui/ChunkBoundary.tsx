import { Component, type ReactNode } from "react";
import styles from "./ChunkBoundary.module.css";

interface Props {
  children: ReactNode;
  /** Shown instead of the children after a failure; null hides the area silently. */
  fallback: "reload" | null;
}

/**
 * Catches render and lazy-import failures of one area (e.g. a chunk removed by a deploy) so the
 * rest of the interface keeps working.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("Interface part failed to load", error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback === null) return null;
    return (
      <div className={styles.reload} role="alert">
        <p>Не удалось загрузить холст. Возможно, игра обновилась.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    );
  }
}
