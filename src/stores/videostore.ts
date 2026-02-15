import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Video } from './secrets/update-videos';

// New Video type that extends the previous one with new fields
export type ExtendedVideo = Video & {
  part: string; // e.g., "B1"
  basename: string; // e.g. "Kyrie"
  seek?: number | undefined; // optional, To seek to the correct part
};

export const useVideoStore = defineStore('video', () => {
  const videos = ref([] as ExtendedVideo[]);

  // Either S1, T1, A1, B1, etc.
  // or "ALL"
  const partnameRegex: RegExp = /((A|B|T|S)\d(-\d)?|ALL|Kaikki|Solo)$/;

  function setVideos(v: Video[]) {
    videos.value = v
      .filter((vid) => vid.title !== 'Deleted video')
      .map((vid) => {
      const partMatch = vid.title.match(partnameRegex);
      const part = (partMatch ? partMatch[0] : "UNKNOWN").replace('ALL', 'Kaikki');
      const basename = vid.title.replace(partnameRegex, "").replace("stemmanauha", "").replace("Stemmanauha", "").trim();
      return { ...vid, part, basename };
    });
  }
  const videosByBasename = computed(() => {
    const ret: { [key: string]: ExtendedVideo[] } = {};
    for (const v of videos.value) {
      const base = v.basename;
      if (!ret[base]) {
        ret[base] = [];
      }
      // check if there are parts or all are UNKNOWN
      // if all are UNKNOWN, handle that case
      if (v.part === "UNKNOWN") {
        // We will split this video into 5 parts of equal length
        // ALL, T1, T2, B1, B2
        // This is a naive split, in real scenarios you might want to use video duration
        const parts = ["Kaikki", "T1", "T2", "B1", "B2"];
        for (const index in parts) {
          const p = parts[index];
          ret[base].push({ ...v, part: p, seek: parseInt(index) });
        }
      } else {
        // Normal case, just add the video as is
        ret[base].push(v);
      }
    }
    // Sort each array by part names as follows:
    // ALL/Kaikki first, then S, then A, then W, then T, then B, then M
    for (const key in ret) {
      ret[key].sort((a, b) => {
        const order = (part: string) => {
          if (part === "ALL" || part === "Kaikki") return 0;
          if (part.startsWith("S")) return 1;
          if (part.startsWith("A")) return 2;
          if (part.startsWith("W")) return 3;
          if (part.startsWith("T")) return 4;
          if (part.startsWith("B")) return 5;
          if (part.startsWith("M")) return 6;
          return 99; // Unknown parts go last
        };
        const orderA = order(a.part);
        const orderB = order(b.part);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // If same category, sort by part number if applicable
        const numA = parseInt(a.part.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.part.replace(/\D/g, '')) || 0;
        return numA - numB;
      });
    }

    return ret;
  });

  const sortedVideosByBasename = computed(() => {
    const entries = Object.entries(videosByBasename.value);
    entries.sort((a, b) => a[0].localeCompare(b[0], 'fi'));
    return Object.fromEntries(entries);
  });

  const newestBasenames = computed(() => {
    const entries = Object.entries(videosByBasename.value);
    entries.sort((a, b) => {
      const aDate = new Date(a[1][0].publishedAt).getTime();
      const bDate = new Date(b[1][0].publishedAt).getTime();
      return bDate - aDate;
    });
    return new Set(entries.slice(0, 3).map((e) => e[0]));
  });

  return { setVideos, videosByBasename, sortedVideosByBasename, newestBasenames }
})
