import type { UserRef } from "@rave/shared";
import type { Db } from "../db/client";
import { users } from "../db/schema";

/** In-memory id → display name, for feed and explosion messages. */
export class UserDirectory {
  private names = new Map<number, string>();

  static async load(db: Db): Promise<UserDirectory> {
    const dir = new UserDirectory();
    for (const u of await db.select({ id: users.id, username: users.username }).from(users)) dir.set(u.id, u.username);
    return dir;
  }

  set(id: number, name: string): void {
    this.names.set(id, name);
  }

  ref(id: number): UserRef {
    return { id, name: this.names.get(id) ?? `#${id}` };
  }
}
