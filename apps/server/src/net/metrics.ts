/**
 * Prometheus text exposition without dependencies: counters, gauges read at scrape time and
 * cumulative histograms. Label values are short internal codes, never user input.
 */

type Labels = Record<string, string>;

const labelKey = (labels: Labels | undefined) =>
  labels === undefined
    ? ""
    : Object.keys(labels)
        .sort()
        .map((k) => `${k}="${labels[k]!.replace(/["\\\n]/g, "_")}"`)
        .join(",");

const series = (name: string, key: string, suffix = "") => (key === "" ? `${name}${suffix}` : `${name}${suffix}{${key}}`);

export class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels?: Labels, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get(labels?: Labels): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  /** Sum over every label combination. */
  total(): number {
    let sum = 0;
    for (const v of this.values.values()) sum += v;
    return sum;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) lines.push(`${series(this.name, key)} ${value}`);
    return lines;
  }
}

export class Gauge {
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly read: () => number,
  ) {}

  value(): number {
    return this.read();
  }

  render(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, `${this.name} ${this.read()}`];
  }
}

export class Histogram {
  private readonly counts: number[];
  private sum = 0;
  private count = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    /** Upper bounds, ascending. */
    readonly buckets: number[],
  ) {
    this.counts = buckets.map(() => 0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]!) this.counts[i]!++;
  }

  /** Upper bound of the bucket holding quantile `q`; Infinity when it falls past the last bucket, null with no data. */
  quantile(q: number): number | null {
    if (this.count === 0) return null;
    const rank = q * this.count;
    for (let i = 0; i < this.buckets.length; i++) if (this.counts[i]! >= rank) return this.buckets[i]!;
    return Number.POSITIVE_INFINITY;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    this.buckets.forEach((le, i) => {
      lines.push(`${this.name}_bucket{le="${le}"} ${this.counts[i]}`);
    });
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`, `${this.name}_sum ${this.sum}`, `${this.name}_count ${this.count}`);
    return lines;
  }
}

const MS_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

/** Every metric the server exposes. Gauges that read live state are attached by their owner (`gauge`). */
export class Metrics {
  readonly actions = new Counter("rave_actions_total", "Player actions by type");
  readonly rejects = new Counter("rave_rejects_total", "Rejected player actions by type and code");
  readonly rateLimited = new Counter("rave_rate_limited_total", "Sockets closed for exceeding the message rate");
  readonly chatMessages = new Counter("rave_chat_messages_total", "Chat messages accepted");
  readonly commitMs = new Histogram("rave_commit_duration_ms", "Group commit duration", MS_BUCKETS);
  readonly commitEvents = new Histogram("rave_commit_events", "Engine events per commit", [1, 5, 10, 50, 100, 500, 1000, 5000]);
  readonly broadcastMs = new Histogram("rave_broadcast_duration_ms", "Time to publish one commit to sockets", MS_BUCKETS);
  private readonly gauges: Gauge[] = [new Gauge("rave_memory_rss_bytes", "Resident set size", () => process.memoryUsage().rss)];

  gauge(name: string, help: string, read: () => number): void {
    this.gauges.push(new Gauge(name, help, read));
  }

  /** Counts an action and, when the result is a rejection, its code. */
  track(type: string, result: { ok: boolean; code?: string }): void {
    this.actions.inc({ type });
    if (!result.ok) this.rejects.inc({ type, code: result.code ?? "unknown" });
  }

  render(): string {
    const all = [this.actions, this.rejects, this.rateLimited, this.chatMessages, this.commitMs, this.commitEvents, this.broadcastMs, ...this.gauges];
    return `${all.flatMap((m) => m.render()).join("\n")}\n`;
  }
}
