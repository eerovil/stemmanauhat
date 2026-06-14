/**
 * Crop/zoom transform for the YouTube player.
 *
 * The player <iframe> is scaled up inside an overflow:hidden wrapper, turning the
 * wrapper into a "window" onto a magnified part of the video.
 *  - scale:   zoom factor (1 = no zoom).
 *  - originX/originY: CSS transform-origin in percent (0..100). 50/50 = centre.
 *    Because the iframe is scaled larger than the wrapper, the origin point stays
 *    fixed, so it doubles as the pan target (0/0 = top-left region, 100/100 = bottom-right).
 */
export type Crop = {
  scale: number;
  originX: number;
  originY: number;
};

export type CropPresets = {
  /** Default crop per voice part (e.g. "S1", "B2", "Kaikki"), shared across all songs. */
  byPart: Record<string, Crop>;
  /** Per-song overrides: bySong[basename][part]. Wins over byPart. */
  bySong: Record<string, Record<string, Crop>>;
};

export const IDENTITY_CROP: Crop = { scale: 1, originX: 50, originY: 50 };

export function emptyPresets(): CropPresets {
  return { byPart: {}, bySong: {} };
}

/** If part is like "S1-1", return "S1"; otherwise return the part unchanged. */
export function cropBasePart(part: string): string {
  return part.replace(/-\d+$/, '');
}

/**
 * Resolve the crop for a selected video, most specific first:
 * per-song+part -> per-song+basePart -> global part -> global basePart -> identity.
 */
export function resolveCrop(
  presets: CropPresets | null | undefined,
  basename: string,
  part: string,
): Crop {
  if (!presets) return { ...IDENTITY_CROP };
  const base = cropBasePart(part);
  const song = presets.bySong?.[basename];
  const found =
    song?.[part] ??
    (base !== part ? song?.[base] : undefined) ??
    presets.byPart?.[part] ??
    (base !== part ? presets.byPart?.[base] : undefined);
  return found ? { ...found } : { ...IDENTITY_CROP };
}
