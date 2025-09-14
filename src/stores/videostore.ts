// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useVideoStore = defineStore('video', () => {
  const playlistID = ref(null as string | null);

  function setPlaylistID(p: string) {
    playlistID.value = p;
  }
  return { setPlaylistID }
})
