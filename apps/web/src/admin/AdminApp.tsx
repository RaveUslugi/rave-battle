import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "../net/trpc";
import styles from "./admin.module.css";
import { ConfigSection } from "./ConfigSection";
import { ModLogSection } from "./ModLogSection";
import { PlayersSection } from "./PlayersSection";
import { useSearchParam } from "./useSearchParam";

const TABS = [
  { id: "players", label: "Игроки" },
  { id: "config", label: "Конфиг" },
  { id: "log", label: "Журнал" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminApp() {
  const trpc = useTRPC();
  const whoami = useQuery(trpc.admin.whoami.queryOptions());
  const [tabParam, setTab] = useSearchParam("tab");
  const tab: TabId = TABS.find((t) => t.id === tabParam)?.id ?? "players";

  if (whoami.isPending) {
    return (
      <div className={styles.root}>
        <p className={styles.message}>Загрузка…</p>
      </div>
    );
  }
  if (whoami.isError) {
    return (
      <div className={styles.root}>
        <div className={styles.page}>
          <h1 className={styles.title}>Не удалось проверить доступ</h1>
          <button type="button" className={styles.button} onClick={() => void whoami.refetch()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (!whoami.data.admin) {
    return (
      <div className={styles.root}>
        <div className={styles.page}>
          <h1 className={styles.title}>Нет доступа</h1>
          <p className={styles.message}>Если вы администратор, сначала войдите на главной странице.</p>
          <a className={styles.link} href="/">← К холсту</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Rave Battle · админка</h1>
          <a className={styles.link} href="/">← К холсту</a>
        </header>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={styles.tab} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab === "players" && <PlayersSection />}
        {tab === "config" && <ConfigSection />}
        {tab === "log" && <ModLogSection />}
      </div>
    </div>
  );
}
