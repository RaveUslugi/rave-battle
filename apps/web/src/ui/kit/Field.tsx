import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { Icon } from "./Icon";
import styles from "./kit.module.css";

export interface FieldProps {
  label: ReactNode;
  /** Shown after the input: "секунд", "монет". */
  unit?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Renders the control with the ids that tie it to the label, hint and error. */
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, unit, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <span className={styles.fieldRow}>
        {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
        {unit && <span className={styles.unit}>{unit}</span>}
      </span>
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks a value that differs from the saved one (gold border). */
  changed?: boolean;
}

export function Input({ changed, className, ...rest }: InputProps) {
  return <input className={[styles.input, className].filter(Boolean).join(" ")} data-changed={changed || undefined} {...rest} />;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.checkbox, className].filter(Boolean).join(" ")}>
      <input type="checkbox" {...rest} />
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" size={12} />
      </span>
      {label}
    </label>
  );
}
