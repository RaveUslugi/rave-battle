import { BASE_COLOR_COUNT, defaultPaletteParams, MAX_PALETTE_SIZE, type PaletteEntry, type PaletteType } from "@rave/shared";
import { useState } from "react";
import { useTranslation } from "../../i18n";
import { Button, ColorPreview, Field, IconButton, Input, Segmented, Swatch } from "../../ui/kit";
import styles from "../admin.module.css";
import f from "./config.module.css";
import { type Issues, issuesUnder } from "./draft";

const TYPES: PaletteType[] = ["solid", "animated", "gradient"];
const UNLOCKS: PaletteEntry["unlock"][] = ["default", "shop", "daily", "achievement"];
const MAX_COLORS = { animated: 8, gradient: 6 };

/** A colour field: the native picker next to the hex text (either can be used). */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <Field label={label}>
      {(c) => (
        <span className={f.colorInput}>
          <input
            type="color"
            aria-label={label}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
          />
          <Input {...c} value={value} maxLength={7} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </span>
      )}
    </Field>
  );
}

const numberValue = (v: number) => (Number.isFinite(v) ? String(v) : "");
const parse = (s: string) => (s === "" ? Number.NaN : Number(s));

/** The palette as a grid of swatches; the picked colour is edited on the side. */
export function PaletteEditor({
  palette,
  saved,
  issues,
  onChange,
}: {
  palette: PaletteEntry[];
  saved: PaletteEntry[];
  issues: Issues;
  onChange: (p: PaletteEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(palette[BASE_COLOR_COUNT]?.id ?? palette[0]?.id ?? 0);
  const index = palette.findIndex((e) => e.id === selected);
  const entry = palette[index];
  const before = saved.find((e) => e.id === selected);
  const update = (next: PaletteEntry) => onChange(palette.map((e, i) => (i === index ? next : e)));
  const problems = index === -1 ? [] : issuesUnder(issues, `palette.${index}`);
  const listProblems = issues.get("palette") ?? [];
  const nextId = Math.max(-1, ...palette.map((e) => e.id)) + 1;

  const add = () => {
    if (nextId >= MAX_PALETTE_SIZE) return;
    onChange([...palette, { id: nextId, type: "solid", base: "#FFFFFF", unlock: "shop", price: 100, params: {} }]);
    setSelected(nextId);
  };
  const remove = () => {
    onChange(palette.filter((e) => e.id !== selected));
    setSelected(palette[Math.max(0, index - 1)]?.id ?? 0);
  };
  const setType = (type: PaletteType) => entry && update({ ...entry, type, params: defaultPaletteParams(type, entry.base) } as PaletteEntry);

  return (
    <div className={f.palette}>
      <div className={styles.form}>
        <div role="radiogroup" aria-label={t("admin.config.paletteColors")} className={f.swatches}>
          {palette.map((e, i) => (
            <span key={e.id} className={f.swatchCell} data-problem={issuesUnder(issues, `palette.${i}`).length > 0 || undefined}>
              <Swatch entry={e} size={28} selected={e.id === selected} tabIndex={e.id === selected ? 0 : -1} onSelect={() => setSelected(e.id)} />
              <span className={f.swatchId}>{e.id}</span>
            </span>
          ))}
        </div>
        <Button icon="plus" disabled={nextId >= MAX_PALETTE_SIZE} onClick={add}>
          {t("admin.config.addColor")}
        </Button>
        {listProblems.map((p) => (
          <p key={p} className={styles.error}>
            {p}
          </p>
        ))}
      </div>
      {entry && (
        <div className={`${styles.box} ${f.colorEditor}`}>
          <div className={styles.row}>
            <h2 className={styles.h2} style={{ flex: 1 }}>
              {t("kit.colorN", { id: entry.id })}
            </h2>
            {entry.id >= BASE_COLOR_COUNT && <IconButton icon="close" label={t("admin.config.removeColor")} onClick={remove} />}
          </div>
          <div className={f.previewRow}>
            <ColorPreview entry={entry} className={f.bigPreview} />
            <span className={styles.muted}>{t("admin.config.preview")}</span>
          </div>
          <Segmented
            label={t("admin.config.colorType")}
            value={entry.type}
            onChange={setType}
            options={TYPES.map((v) => ({ value: v, label: t(`admin.config.${v}`) }))}
          />
          {before && before.type !== entry.type && <p className={styles.muted}>{t("admin.config.typeLocked")}</p>}
          <ColorInput label={t("admin.config.base")} value={entry.base} onChange={(base) => update({ ...entry, base })} />
          {entry.type !== "solid" && (
            <ColorList
              label={entry.type === "animated" ? t("admin.config.frames") : t("admin.config.stops")}
              colors={entry.type === "animated" ? entry.params.frames : entry.params.stops}
              max={MAX_COLORS[entry.type]}
              onChange={(colors) =>
                update(
                  entry.type === "animated"
                    ? { ...entry, params: { ...entry.params, frames: colors } }
                    : { ...entry, params: { ...entry.params, stops: colors } },
                )
              }
            />
          )}
          {entry.type === "animated" && (
            <Field label={t("admin.config.periodMs")} unit={t("admin.unit.seconds")}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  step="0.1"
                  value={Number.isFinite(entry.params.periodMs) ? String(entry.params.periodMs / 1000) : ""}
                  onChange={(e) => update({ ...entry, params: { ...entry.params, periodMs: Math.round(parse(e.target.value) * 1000) } })}
                />
              )}
            </Field>
          )}
          {entry.type === "gradient" &&
            (["scale", "angle", "speed"] as const).map((key) => (
              <Field key={key} label={t(`admin.config.${key}`)}>
                {(c) => (
                  <Input
                    {...c}
                    type="number"
                    step={key === "speed" ? "0.05" : "1"}
                    value={numberValue(entry.params[key])}
                    onChange={(e) => update({ ...entry, params: { ...entry.params, [key]: parse(e.target.value) } })}
                  />
                )}
              </Field>
            ))}
          <Segmented
            label={t("admin.config.unlock")}
            value={entry.unlock}
            onChange={(unlock) => update({ ...entry, unlock, ...(unlock === "shop" && entry.price === undefined ? { price: 100 } : {}) })}
            options={UNLOCKS.map((u) => ({ value: u, label: t(`admin.config.unlockKind.${u}`) }))}
          />
          {entry.unlock === "shop" && (
            <Field label={t("admin.config.price")} unit={t("admin.unit.coins")}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  value={numberValue(entry.price ?? Number.NaN)}
                  onChange={(e) => update({ ...entry, price: parse(e.target.value) })}
                />
              )}
            </Field>
          )}
          {(["ru", "en"] as const).map((lang) => (
            <Field key={lang} label={t(lang === "ru" ? "admin.config.nameRu" : "admin.config.nameEn")}>
              {(c) => (
                <Input
                  {...c}
                  value={entry.name?.[lang] ?? ""}
                  maxLength={32}
                  onChange={(e) => {
                    const name = { ru: entry.name?.ru ?? "", en: entry.name?.en ?? "", [lang]: e.target.value };
                    const { name: _old, ...rest } = entry;
                    update(name.ru === "" && name.en === "" ? (rest as PaletteEntry) : { ...entry, name });
                  }}
                />
              )}
            </Field>
          ))}
          {problems.map((p) => (
            <p key={p} className={styles.error}>
              {p}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorList({ label, colors, max, onChange }: { label: string; colors: string[]; max: number; onChange: (c: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.form}>
      <span className={f.label}>{label}</span>
      {colors.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positions in the frame list
        <div key={i} className={styles.row}>
          <ColorInput label={`${label} ${i + 1}`} value={c} onChange={(hex) => onChange(colors.map((x, j) => (j === i ? hex : x)))} />
          <IconButton
            icon="minus"
            size={36}
            label={t("admin.config.removeFrame")}
            disabled={colors.length <= 2}
            onClick={() => onChange(colors.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button icon="plus" disabled={colors.length >= max} onClick={() => onChange([...colors, colors.at(-1) ?? "#FFFFFF"])}>
        {t("admin.config.addFrame")}
      </Button>
    </div>
  );
}
