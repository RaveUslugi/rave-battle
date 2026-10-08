/**
 * Browser entry point: everything the web client needs, without the zod config schema
 * (its schemas are built at module load, so bundlers cannot tree-shake zod away).
 */
export * from "./constants";
export * from "./time";
export * from "./protocol";
export type { GameConfig, ItemKey, PaletteEntry, Reward } from "./config/schema";
