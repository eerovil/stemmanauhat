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
 * Generalized fallback crop pattern, used when a part has no saved preset.
 * The choir sits on the left of the frame, so zoom and horizontal pan are
 * constant; only the vertical position changes per voice part, evenly spaced
 * top -> bottom across however many parts the song has (3, 4, 5, ...).
 * Tuned from hand-set presets (originX ~30, scale ~2.4; for a 4-part song this
 * gives originY 12.5 / 37.5 / 62.5 / 87.5).
 */
export const DEFAULT_CROP_SCALE = 2.2;
export const DEFAULT_CROP_ORIGIN_X = 30;

/** True for the wide "all voices" entry, which keeps the wide shot. */
function isAllPart(part: string): boolean {
  return part === 'Kaikki' || part === 'ALL';
}

/** Vertical rank of a voice part: sopranos high (top) ... basses low (bottom). */
function voiceRank(part: string): number {
  if (isAllPart(part)) return 0;
  const rank: Record<string, number> = { S: 1, A: 2, W: 3, T: 4, B: 5, M: 6 };
  return rank[part[0]] ?? 99;
}

/** The real (non-"Kaikki") voice parts of a song, ordered top -> bottom. */
export function orderVoiceParts(parts: string[]): string[] {
  return parts
    .filter((p) => !isAllPart(p))
    .slice()
    .sort((a, b) => {
      const r = voiceRank(a) - voiceRank(b);
      if (r !== 0) return r;
      // Part number then divisi, parsed separately so T1-1 -> 1,1 (not 11) and
      // the whole T1 group sorts before T2.
      const nums = (p: string): [number, number] => {
        const m = p.match(/(\d+)(?:-(\d+))?/);
        return [m ? +m[1] : 0, m && m[2] ? +m[2] : 0];
      };
      const [pa, sa] = nums(a);
      const [pb, sb] = nums(b);
      return pa !== pb ? pa - pb : sa - sb;
    });
}

/**
 * Crop derived from the generalized pattern for `part`, given the full set of
 * `songParts`. The part's row is its position among the song's parts (ordered
 * top -> bottom), evenly spaced. Kaikki / unknown -> wide shot.
 */
export function defaultCropForPart(part: string, songParts: string[] = []): Crop {
  if (isAllPart(part)) return { ...IDENTITY_CROP };
  const ordered = orderVoiceParts(songParts);
  const base = cropBasePart(part);
  let row = ordered.indexOf(part);
  if (row < 0) row = ordered.indexOf(base);
  if (row < 0 || ordered.length === 0) return { ...IDENTITY_CROP };
  return {
    scale: DEFAULT_CROP_SCALE,
    originX: DEFAULT_CROP_ORIGIN_X,
    originY: ((row + 0.5) / ordered.length) * 100,
  };
}

/**
 * Resolve the crop for a selected video, most specific first:
 * per-song+part -> per-song+basePart -> global part -> global basePart ->
 * generalized per-part default (spaced across `songParts`).
 */
export function resolveCrop(
  presets: CropPresets | null | undefined,
  basename: string,
  part: string,
  songParts: string[] = [],
): Crop {
  const base = cropBasePart(part);
  const song = presets?.bySong?.[basename];
  const found =
    song?.[part] ??
    (base !== part ? song?.[base] : undefined) ??
    presets?.byPart?.[part] ??
    (base !== part ? presets?.byPart?.[base] : undefined);
  return found ? { ...found } : defaultCropForPart(part, songParts);
}
