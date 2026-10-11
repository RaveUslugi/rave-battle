import { useGame } from "../state/game-store";
import styles from "./AuthPanel.module.css";

/** The server answers 204 and closes this user's sockets (code 4001); the client then reconnects anonymously. */
function logout(): void {
  fetch("/auth/logout", { method: "POST" }).catch(() => {
    // Network failure: nothing to undo, the user can simply try again.
  });
}

export function AuthPanel() {
  const user = useGame((s) => s.user);
  const admin = useGame((s) => s.admin);

  if (user) {
    return (
      <div className={styles.panel}>
        <span className={styles.name} title={user.name}>
          {user.name}
        </span>
        {admin && (
          <a className={styles.button} href="/admin">
            Админка
          </a>
        )}
        <button type="button" className={styles.button} onClick={logout}>
          Выйти
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <a className={styles.discord} href="/auth/discord">
        Войти через Discord
      </a>
      {import.meta.env.DEV && (
        <form className={styles.dev} action="/auth/dev" method="get">
          <input
            name="name"
            placeholder="dev-имя"
            aria-label="Имя для dev-входа"
            pattern="[A-Za-z0-9_]{1,32}"
            autoComplete="off"
            required
          />
          <button type="submit" className={styles.button}>
            Dev
          </button>
        </form>
      )}
    </div>
  );
}
