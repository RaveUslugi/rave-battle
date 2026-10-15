import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { useTranslation } from "../i18n";
import { useTRPC } from "../net/trpc";
import { Button, Icon, type IconName } from "../ui/kit";
import styles from "./admin.module.css";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./DashboardPage";
import { LogPage } from "./LogPage";
import { PlayersPage } from "./players/PlayersPage";
import { useSearchParams } from "./useSearchParam";

// The canvas page pulls in the renderer: load it only when opened.
const CanvasPage = lazy(() => import("./canvas/CanvasPage"));

const PAGES: Array<{ id: Page; icon: IconName }> = [
  { id: "dashboard", icon: "chart" },
  { id: "players", icon: "users" },
  { id: "canvas", icon: "area" },
  { id: "config", icon: "sliders" },
  { id: "log", icon: "list" },
];
type Page = "dashboard" | "players" | "canvas" | "config" | "log";

function Gate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const whoami = useQuery(trpc.admin.whoami.queryOptions());
  if (whoami.isPending) return <p className={styles.center}>{t("admin.access.checking")}</p>;
  if (whoami.isError)
    return (
      <div className={styles.center}>
        <h1 className={styles.h1}>{t("admin.access.failed")}</h1>
        <Button onClick={() => void whoami.refetch()}>{t("common.retry")}</Button>
      </div>
    );
  if (!whoami.data.admin)
    return (
      <div className={styles.center}>
        <h1 className={styles.h1}>{t("admin.access.denied")}</h1>
        <p className={styles.muted}>{t("admin.access.deniedHint")}</p>
        <a className={styles.link} href="/">
          {t("admin.nav.back")}
        </a>
      </div>
    );
  return <>{children}</>;
}

export default function AdminApp() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const page: Page = PAGES.find((p) => p.id === params.get("tab"))?.id ?? "dashboard";
  return (
    <div className={styles.root}>
      <Gate>
        <nav className={styles.nav} aria-label={t("admin.nav.label")}>
          <div className={styles.logo} aria-hidden="true">
            <span className={styles.pink}>RAVE</span>
            <span className={styles.cyan}>BATTLE</span>
          </div>
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`?tab=${p.id}`}
              className={styles.navItem}
              aria-current={page === p.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setParams({ tab: p.id }, true);
              }}
            >
              <Icon name={p.icon} size={20} />
              {t(`admin.nav.${p.id}`)}
            </a>
          ))}
          <a className={styles.navBack} href="/">
            <Icon name="back" size={20} />
            {t("admin.nav.back")}
          </a>
        </nav>
        <main className={page === "canvas" ? styles.mainCanvas : styles.main}>
          {page === "dashboard" && <DashboardPage />}
          {page === "players" && <PlayersPage />}
          {page === "canvas" && (
            <Suspense fallback={<p className={styles.muted}>{t("common.loading")}</p>}>
              <CanvasPage />
            </Suspense>
          )}
          {page === "config" && <ConfigPage />}
          {page === "log" && <LogPage />}
        </main>
      </Gate>
    </div>
  );
}
