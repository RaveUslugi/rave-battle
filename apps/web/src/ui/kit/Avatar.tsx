import { useState } from "react";
import styles from "./kit.module.css";

const COLORS = ["#ff3dae", "#3de8ff", "#b4ff4d", "#ffc83d", "#ff7a3d", "#bc13fe"];

/** Stable colour for a user without an avatar picture. */
export const avatarColor = (userId: number) => COLORS[((userId % COLORS.length) + COLORS.length) % COLORS.length]!;

/** First letter (Unicode-aware), upper-cased; "?" for an empty name. */
export const initialOf = (name: string) => ([...name.trim()][0] ?? "?").toUpperCase();

export interface AvatarProps {
  user: { id: number; name: string };
  /** Discord avatar URL; falls back to the initial if missing or broken. */
  src?: string | null;
  size?: number;
}

export function Avatar({ user, src, size = 32 }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: showImage ? "var(--card)" : avatarColor(user.id), fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {showImage ? <img src={src} alt="" onError={() => setBroken(true)} /> : initialOf(user.name)}
    </span>
  );
}
