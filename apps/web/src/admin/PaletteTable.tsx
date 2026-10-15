import { useEffect, useState } from "react";
import type { PaletteEntry } from "@rave/shared";
import styles from "./admin.module.css";

const TYPES: PaletteEntry["type"][] = ["solid", "animated", "gradient"];
const UNLOCKS: PaletteEntry["unlock"][] = ["default", "shop", "daily", "achievement"];
const FIRST_FREE_ID = 32;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** One-line JSON editor: while the text does not parse, the draft keeps the last valid params. */
function ParamsInput({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value));
  const parsed = tryParse(text);

  // Follow external changes (reload of the current version) without fighting the typing.
  useEffect(() => {
    if (JSON.stringify(parsed) !== JSON.stringify(value)) setText(JSON.stringify(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={`${styles.input} ${styles.mono}`}
      value={text}
      aria-label="params"
      aria-invalid={parsed === null}
      onChange={(e) => {
        setText(e.target.value);
        const next = tryParse(e.target.value);
        if (next) onChange(next);
      }}
    />
  );
}

export function PaletteTable({ value, onChange }: { value: PaletteEntry[]; onChange: (palette: PaletteEntry[]) => void }) {
  const update = (index: number, patch: Partial<PaletteEntry>) => onChange(value.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const add = () => {
    const used = new Set(value.map((e) => e.id));
    let id = FIRST_FREE_ID;
    while (used.has(id)) id++;
    onChange([...value, { id, type: "solid", unlock: "shop", price: 300, base: "#ffffff", params: {} }]);
  };

  return (
    <div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th />
              <th>base</th>
              <th>type</th>
              <th>unlock</th>
              <th>price</th>
              <th>params</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {value.map((e, i) => (
              <tr key={i}>
                <td>
                  <input
                    className={`${styles.input} ${styles.narrow}`}
                    type="number"
                    inputMode="numeric"
                    aria-label="id"
                    value={Number.isNaN(e.id) ? "" : e.id}
                    onChange={(ev) => update(i, { id: ev.target.value === "" ? Number.NaN : Number(ev.target.value) })}
                  />
                </td>
                <td>
                  <span className={styles.swatch} style={{ background: e.base }} aria-hidden="true" />
                </td>
                <td>
                  <div className={styles.colorCell}>
                    <input
                      type="color"
                      aria-label="Цвет"
                      value={/^#[0-9A-Fa-f]{6}$/.test(e.base) ? e.base : "#000000"}
                      onChange={(ev) => update(i, { base: ev.target.value })}
                    />
                    <input
                      className={`${styles.input} ${styles.hex} ${styles.mono}`}
                      aria-label="base"
                      value={e.base}
                      aria-invalid={!/^#[0-9A-Fa-f]{6}$/.test(e.base)}
                      onChange={(ev) => update(i, { base: ev.target.value })}
                    />
                  </div>
                </td>
                <td>
                  <select
                    className={styles.input}
                    aria-label="type"
                    value={e.type}
                    onChange={(ev) => update(i, { type: ev.target.value as PaletteEntry["type"] })}
                  >
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className={styles.input}
                    aria-label="unlock"
                    value={e.unlock}
                    onChange={(ev) => {
                      const unlock = ev.target.value as PaletteEntry["unlock"];
                      const { price, ...rest } = e;
                      const next: PaletteEntry = unlock === "shop" ? { ...rest, unlock, price: price ?? 300 } : { ...rest, unlock };
                      onChange(value.map((x, j) => (j === i ? next : x)));
                    }}
                  >
                    {UNLOCKS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className={`${styles.input} ${styles.narrow}`}
                    type="number"
                    inputMode="numeric"
                    aria-label="price"
                    disabled={e.unlock !== "shop"}
                    value={e.unlock === "shop" && e.price !== undefined && !Number.isNaN(e.price) ? e.price : ""}
                    onChange={(ev) => update(i, { price: ev.target.value === "" ? undefined : Number(ev.target.value) })}
                  />
                </td>
                <td>
                  <ParamsInput value={e.params} onChange={(params) => update(i, { params })} />
                </td>
                <td>
                  <button type="button" className={styles.button} aria-label={`Удалить цвет ${e.id}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={styles.button} onClick={add}>
        Добавить цвет
      </button>
    </div>
  );
}
