import { defaultConfig, gameConfigSchema } from "@rave/shared";
import { desc } from "drizzle-orm";
import { createDb } from "../db/client";
import { gameConfig } from "../db/schema";

/**
 * Dev helper until the config editor exists (plan 5): stores the current code defaults as the newest
 * config version. The running server picks it up on restart.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production" && !process.argv.includes("--yes")) {
  throw new Error("Refusing to run with NODE_ENV=production; pass --yes to override");
}
const target = new URL(url);
console.log(`Target database: ${target.host}${target.pathname}`);
const { db, close } = createDb(url);
try {
  const data = gameConfigSchema.parse(defaultConfig);
  const [latest] = await db.select().from(gameConfig).orderBy(desc(gameConfig.version)).limit(1);
  if (latest && Bun.deepEquals(latest.data, data)) {
    console.log(`Config version ${latest.version} is already up to date.`);
  } else {
    const [row] = await db.insert(gameConfig).values({ data, comment: "defaults from code" }).returning({ version: gameConfig.version });
    console.log(`Stored config version ${row!.version}; restart the server to apply it.`);
  }
} finally {
  await close();
}
