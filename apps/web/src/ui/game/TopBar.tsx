import { type Locale, LOCALES } from "@rave/shared/client";
import { useEffect, useId, useRef, useState } from "react";
import { formatNumber, useLocale, useTranslation } from "../../i18n";
import { settingsApi } from "../../net/api";
import { useGame } from "../../state/game-store";
import { uiStore } from "../../state/ui-store";
import { Avatar, Button, Icon, Segmented } from "../kit";
import { ChargeMeter, Coins } from "./resources";
import styles from "./top.module.css";

/** The server answers 204 and closes this user's sockets (code 4001); the client then reconnects anonymously. */
export function logout(): void {
  fetch("/auth/logout", { method: "POST" }).catch(() => {
    // Network failure: nothing to undo, the user can simply try again.
  });
}

/** The interface language; a logged-in player's choice is also saved on the server. */
export function useGameLocale(): [Locale, (locale: Locale) => void] {
  const loggedIn = useGame((s) => s.user !== null);
  return useLocale(loggedIn ? (locale) => void settingsApi.setLocale(locale) : undefined);
}

export function LanguageSwitch() {
  const { t } = useTranslation();
  const [locale, setLocale] = useGameLocale();
  return (
    <Segmented
      label={t("locale.label")}
      value={locale}
      onChange={setLocale}
      options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
      className={styles.language}
    />
  );
}

/** Connection state and players online; the e2e tests read it by `data-testid="status"`. */
export function ConnectionStatus({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation();
  const status = useGame((s) => s.status);
  const online = useGame((s) => s.online);
  const text = status === "open" ? (online > 0 ? t("status.online", { n: formatNumber(online) }) : t("status.open")) : t(`status.${status}`);
  return (
    <span role="status" data-testid="status" className={hidden ? "visually-hidden" : styles.status} data-state={status}>
      {!hidden && <span className={styles.dot} aria-hidden="true" />}
      {text}
    </span>
  );
}

function Online() {
  const { t } = useTranslation();
  const sample = useGame((s) => s.onlineSample);
  const status = useGame((s) => s.status);
  return (
    <div className={styles.online}>
      {status === "open" && sample.length > 0 && (
        <span className={styles.faces} aria-hidden="true">
          {sample.map((u) => (
            <Avatar key={u.id} user={u} size={22} />
          ))}
        </span>
      )}
      <ConnectionStatus />
      {status === "outdated" && (
        <Button variant="primary" onClick={() => location.reload()}>
          {t("status.reload")}
        </Button>
      )}
    </div>
  );
}

function DevLogin() {
  const { t } = useTranslation();
  return (
    <form className={styles.dev} action="/auth/dev" method="get">
      <input name="name" placeholder={t("top.devName")} aria-label={t("top.devName")} pattern="[A-Za-z0-9_]{1,32}" autoComplete="off" required />
      <Button type="submit">{t("top.devLogin")}</Button>
    </form>
  );
}

export function LoginButton({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation();
  return (
    <a className={styles.login} data-wide={wide || undefined} href="/auth/discord">
      <Icon name="user" size={16} />
      {t("top.login")}
    </a>
  );
}

/** Avatar button with the player's menu: profile, language, admin, log out. */
function AccountMenu() {
  const { t } = useTranslation();
  const user = useGame((s) => s.user);
  const admin = useGame((s) => s.admin);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector("button")?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={root} className={styles.account}>
      <button
        type="button"
        className={styles.box}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("top.account", { name: user.name })}
        onClick={() => setOpen(!open)}
      >
        <Avatar user={user} size={32} />
        <span className={styles.name}>{user.name}</span>
        <Icon name="chevronDown" className={styles.muted} />
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          <Button
            variant="ghost"
            icon="user"
            wide
            onClick={() => {
              setOpen(false);
              uiStore.getState().openProfile(null);
            }}
          >
            {t("top.profile")}
          </Button>
          {admin && (
            <a className={styles.menuLink} href="/admin">
              <Icon name="eye" />
              {t("top.admin")}
            </a>
          )}
          <LanguageSwitch />
          <Button variant="ghost" icon="back" wide onClick={logout}>
            {t("top.logout")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Desktop: logo and who is online · charges and coins · the player's menu (or the login button). */
export function DesktopTopBar() {
  const user = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  return (
    <header className={styles.topBar}>
      <div className={styles.box}>
        <span className={styles.logo} aria-hidden="true">
          <span className={styles.pink}>RAVE</span>
          <span className={styles.cyan}>BATTLE</span>
        </span>
        <span className={styles.sep} aria-hidden="true" />
        <Online />
      </div>
      <div className={styles.center}>
        {player && <ChargeMeter />}
        {player && <Coins />}
      </div>
      <div className={styles.right}>
        {user ? (
          <AccountMenu />
        ) : (
          <>
            {import.meta.env.DEV && <DevLogin />}
            <LoginButton />
          </>
        )}
      </div>
    </header>
  );
}

/** Phone: charges, coins and the avatar (opens the profile); guests get the login button. */
export function MobileTopBar() {
  const { t } = useTranslation();
  const user = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  const status = useGame((s) => s.status);
  return (
    <header className={styles.mobileTop}>
      {player ? <ChargeMeter compact /> : <span className={styles.spacer} />}
      {player && <Coins compact />}
      {user ? (
        <button
          type="button"
          className={styles.avatarButton}
          aria-label={t("top.account", { name: user.name })}
          onClick={() => uiStore.getState().openProfile(null)}
        >
          <Avatar user={user} size={30} />
        </button>
      ) : (
        <>
          {import.meta.env.DEV && <DevLogin />}
          <LoginButton />
        </>
      )}
      <ConnectionStatus hidden={status === "open"} />
      {status === "outdated" && (
        <Button variant="primary" onClick={() => location.reload()}>
          {t("status.reload")}
        </Button>
      )}
    </header>
  );
}
