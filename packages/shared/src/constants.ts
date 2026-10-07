/** Side length of a canvas chunk in pixels. Canvas dimensions must be multiples of it. */
export const CHUNK_SIZE = 256;

/** Pixel color is stored as one byte, so the palette has at most 256 entries. */
export const MAX_PALETTE_SIZE = 256;

/** Palette ids 0..31 are base colors available to everyone. */
export const BASE_COLOR_COUNT = 32;
