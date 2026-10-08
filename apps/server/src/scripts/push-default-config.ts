import { defaultConfig, gameConfigSchema } from "@rave/shared";
import { createDb } from "../db/client";
import { gameConfig } from "../db/schema";

/**
 * Dev helper until the config editor exists (plan 5): stores the current code defaults as the newest
 * config version. The running server picks it up on restart.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, close } = createDb(url);
const data = gameConfigSchema.parse(defaultConfig);
const [row] = await db.insert(gameConfig).values({ data, comment: "defaults from code" }).returning({ version: gameConfig.version });
console.log(`Stored config version ${row!.version}; restart the server to apply it.`);
await close();
