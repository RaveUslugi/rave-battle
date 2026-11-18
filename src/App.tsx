import styles from "./App.module.css";

export default function App() {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <h1 className={styles.logo}>
          <span className={styles.pink}>Rave</span>
          <span className={styles.cyan}>Battle</span>
        </h1>
        <p className={styles.status}>
          <span className={styles.dot} aria-hidden="true" />
          Завершен
        </p>
      </header>

      <main className={styles.stage}>
        <section className={styles.hero}>
          <p className={styles.season}>Сезон 1</p>
          <p className={styles.dates}>
            <time dateTime="2026-10-17">17.10.2026</time>
            <span className={styles.dash} aria-hidden="true">
              -
            </span>
            <time dateTime="2026-11-17">17.11.2026</time>
          </p>
        </section>

        <figure className={styles.canvas}>
          <img
            src="/canvas.png"
            width={1653}
            height={1653}
            alt="Холст первого сезона Rave Battle: пиксельные рисунки на чёрном фоне"
          />
        </figure>
      </main>
    </div>
  );
}
