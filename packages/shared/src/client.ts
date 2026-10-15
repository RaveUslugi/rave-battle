/**
 * Browser entry point: everything the web client needs, without the zod config schema
 * (its schemas are built at module load, so bundlers cannot tree-shake zod away).
 */
export * from "./constants";
export * from "./time";
export * from "./locale";
export * from "./protocol";
export type { ConfigIssue, GameConfig, ItemKey, PaletteEntry, PaletteType, Reward } from "./config/schema";
export * from "./admin";
