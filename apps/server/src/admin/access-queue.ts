/** Serializes everything that reads and writes a user's access (ban, unban, first join), one chain per user. */
export class AccessQueue {
  private chains = new Map<number, Promise<void>>();

  run<T>(userId: number, job: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    const result = previous.then(job);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.chains.set(userId, tail);
    void tail.then(() => {
      if (this.chains.get(userId) === tail) this.chains.delete(userId);
    });
    return result;
  }
}
