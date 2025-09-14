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
  const partnameRegex: RegExp = /((A|B|T)\d|ALL|Kaikki)$/;

  function setVideos(v: Video[]) {
    videos.value = v.map(vid => {
      const partMatch = vid.title.match(partnameRegex);
      const part = partMatch ? partMatch[0] : "UNKNOWN";
      const basename = vid.title.replace(partnameRegex, "").trim();
      return { ...vid, part, basename };
    });
    console.log('Videos set in store:', videos.value);
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
        const parts = ["ALL", "T1", "T2", "B1", "B2"];
        for (const index in parts) {
          const p = parts[index];
          ret[base].push({ ...v, part: p, seek: parseInt(index) });
        }
      } else {
        // Normal case, just add the video as is
        ret[base].push(v);
      }
    }
    return ret;
  });

  const sortedVideosByBasename = computed(() => {
    const entries = Object.entries(videosByBasename.value);
    // sort by publishedAt of the first video in each group, descending
    entries.sort((a, b) => {
      const aDate = new Date(a[1][0].publishedAt).getTime();
      const bDate = new Date(b[1][0].publishedAt).getTime();
      return bDate - aDate;
    });
    return Object.fromEntries(entries);
  });

  return { setVideos, videosByBasename, sortedVideosByBasename }
})
