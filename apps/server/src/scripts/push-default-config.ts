import { defaultConfig, gameConfigSchema } from "@rave/shared";
import { desc } from "drizzle-orm";
import { createDb } from "../db/client";
import { gameConfig } from "../db/schema";

/**
 * Seeds the defaults into an empty game_config; the running config is edited in /admin.
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
  const [latest] = await db.select().from(gameConfig).orderBy(desc(gameConfig.version)).limit(1);
  if (latest) {
    console.log(`Config already exists (version ${latest.version}). Edit it in /admin.`);
  } else {
    const data = gameConfigSchema.parse(defaultConfig);
    const [row] = await db.insert(gameConfig).values({ data, comment: "defaults from code" }).returning({ version: gameConfig.version });
    console.log(`Seeded config version ${row!.version} from code defaults.`);
  }
} finally {
  await close();
}
