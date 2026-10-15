import { defaultConfig } from "@rave/shared";
import type { Locale } from "@rave/shared/client";
import { useState } from "react";
import { useLocale, useTranslation } from "../i18n";
import { rejectText } from "../game/messages";
import {
  Avatar,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  ICON_NAMES,
  Icon,
  IconButton,
  Input,
  Panel,
  Segmented,
  Sheet,
  type SheetHeight,
  Swatch,
  Tabs,
  Toast,
} from "../ui/kit";
import styles from "./KitPreview.module.css";

/** Dev-only page (/kit): every kit component on one page, in the current language. */
export default function KitPreview() {
  const { t } = useTranslation();
  const [locale, setLocale] = useLocale();
  const [period, setPeriod] = useState<"day" | "week" | "all">("day");
  const [tab, setTab] = useState<"shop" | "daily" | "ranks">("shop");
  const [color, setColor] = useState(32);
  const [sheet, setSheet] = useState(false);
  const [height, setHeight] = useState<SheetHeight>("half");
  const [confirm, setConfirm] = useState(false);
  const [muted, setMuted] = useState(true);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.logo}>
          <span style={{ color: "var(--pink)" }}>RAVE</span>
          <span style={{ color: "var(--cyan)" }}>BATTLE</span> kit
        </h1>
        <Segmented<Locale>
          label={t("locale.label")}
          value={locale}
          onChange={setLocale}
          options={[
            { value: "ru", label: t("locale.ru") },
            { value: "en", label: t("locale.en") },
          ]}
        />
      </header>

      <Panel title="Buttons">
        <div className={styles.row}>
          <Button variant="primary" icon="bomb">
            30
          </Button>
          <Button>{t("common.save")}</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Ban…
          </Button>
          <Button variant="ghost">{t("common.cancel")}</Button>
          <Button disabled>disabled</Button>
          <IconButton icon="shop" label="shop" />
          <IconButton icon="daily" label="daily" badge />
          <IconButton icon="trophy" label="ranks" pressed />
        </div>
      </Panel>

      <Panel title="Icons">
        <div className={styles.icons}>
          {ICON_NAMES.map((name) => (
            <span key={name} className={styles.iconCell} title={name}>
              <Icon name={name} size={32} />
              <small>{name}</small>
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Choices">
        <div className={styles.column}>
          <Segmented
            label="period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "day", label: "День" },
              { value: "week", label: "7 дней" },
              { value: "all", label: "Всё время" },
            ]}
          />
          <Checkbox label="Также снять все бомбы игрока" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          <Tabs
            label="tabs"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "shop", label: "Магазин", icon: "shop" },
              { id: "daily", label: "Награда", icon: "daily" },
              { id: "ranks", label: "Рейтинги", icon: "trophy" },
            ]}
          >
            <p className={styles.note}>tab: {tab}</p>
          </Tabs>
        </div>
      </Panel>

      <Panel title="Fields">
        <div className={styles.grid}>
          <Field label="Заморозка жертвы" unit="секунд" hint="Действия и восстановление зарядов заблокированы">
            {(c) => <Input {...c} defaultValue="60" inputMode="numeric" style={{ width: 100 }} />}
          </Field>
          <Field label="Бонус автору" unit="монет · было 15" error="Бонус почти равен цене бомбы">
            {(c) => <Input {...c} defaultValue="20" changed style={{ width: 100 }} />}
          </Field>
        </div>
      </Panel>

      <Panel title="Palette">
        <div role="radiogroup" aria-label="palette" className={styles.palette}>
          {defaultConfig.palette.map((entry) => (
            <Swatch key={entry.id} entry={entry} size={28} selected={entry.id === color} locked={entry.id > 33} onSelect={() => setColor(entry.id)} />
          ))}
        </div>
      </Panel>

      <Panel title="Toasts and avatars">
        <div className={styles.column}>
          <Toast tone="error" count={3}>
            {rejectText("no_charges")}
          </Toast>
          <Toast tone="success" icon="defuser">
            +20
          </Toast>
          <Toast tone="info">{t("chat.cooldown", { seconds: 2 })}</Toast>
          <div className={styles.row}>
            {["admin", "pixelwitch", "sapper_77", "glitchy", "bombardir", "Ёжик"].map((name, i) => (
              <Avatar key={name} user={{ id: i + 1, name }} size={40} />
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Sheet">
        <Button onClick={() => setSheet(true)}>Open sheet</Button>
      </Panel>

      <Sheet open={sheet} height={height} onHeightChange={setHeight} onClose={() => setSheet(false)} label="Sheet">
        <div style={{ padding: 16 }}>
          <p className={styles.note}>height: {height}</p>
          <Button onClick={() => setSheet(false)}>{t("common.close")}</Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm}
        title="Заблокировать griefer_01?"
        confirmLabel="Заблокировать навсегда"
        danger
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      >
        Игрок сможет только смотреть.
      </ConfirmDialog>
    </main>
  );
}
