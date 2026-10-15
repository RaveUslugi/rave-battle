import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import styles from "./kit.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: IconName;
  wide?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, wide, className, children, type = "button", ...rest }: ButtonProps) {
  const cls = [styles.button, styles[variant], size === "lg" && styles.large, wide && styles.wide, className].filter(Boolean).join(" ");
  return (
    // biome-ignore lint/a11y/useButtonType: the type comes from props, "button" by default
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 20 : 16} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: IconName;
  /** Required: the button has no visible text. */
  label: string;
  pressed?: boolean;
  /** A small dot, e.g. "a reward is waiting". */
  badge?: boolean;
  size?: number;
}

export function IconButton({ icon, label, pressed, badge, size = 44, className, style, type = "button", ...rest }: IconButtonProps) {
  return (
    // biome-ignore lint/a11y/useButtonType: the type comes from props, "button" by default
    <button
      type={type}
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <Icon name={icon} size={size >= 48 ? 24 : 20} />
      {badge && <span className={styles.badge} aria-hidden="true" />}
    </button>
  );
}
