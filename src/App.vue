<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useSecretStore } from './stores/secretstore';
import { useVideoStore } from './stores/videostore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { computed } from 'vue';
import type { ExtendedVideo } from './stores/videostore';

const secretstore = useSecretStore();
const videostore = useVideoStore();

// Parse path
const route = window.location.pathname;
console.log('Current path:', route);

const decryptedData = ref<string | null>(null);

const user = route.split('/').filter(Boolean)[0] || 'default';
const passphraseFromPath = route.split('/').filter(Boolean)[1] || '';
console.log('User:', user);
console.log('Passphrase from path:', passphraseFromPath);
if (passphraseFromPath) {
  console.log('Setting passphrase from path');
  secretstore.setPassphrase(passphraseFromPath);
  secretstore.decryptData(`${user}.json`).then((decrypted) => {
    console.log('Decrypted data:', new TextDecoder().decode(decrypted));
    decryptedData.value = new TextDecoder().decode(decrypted);
    const dataObj = JSON.parse(decryptedData.value);
    if (dataObj.videos) {
      videostore.setVideos(dataObj.videos);
      console.log('Set videos in videostore:', dataObj.videos);
    } else {
      console.warn('No videos found in decrypted data');
    }
  }).catch((err) => {
    console.error('Decryption failed:', err);
  });
}
const timeString = (isoString: string) => {
  const date = new Date(isoString);
  return date.toLocaleDateString("fi", {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};
const selectedVideo = ref<ExtendedVideo | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null;

// Add YT type to window
declare global {
  interface Window {
    YT: unknown;
  }
}

const onPlayerReady = (event: { target: { playVideo: () => void; }; }) => {
  console.log('Player ready');
  event.target.playVideo();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onPlayerError = (event: any) => {
  let errorMsg = '';
  switch (event.data) {
    case 2:
      errorMsg = 'Invalid video ID';
      console.error('Invalid video ID');
      break;
    case 5:
      errorMsg = 'HTML5 player error.';
      console.error('HTML5 player error.');
      break;
    case 100:
      errorMsg = 'Video not found or has been removed.';
      console.error('Video not found or has been removed.');
      break;
    case 101:
    case 150:
      errorMsg = 'Embedding of this video is not allowed.';
      console.error('Embedding of this video is not allowed.');
      break;
    default:
      errorMsg = 'An unknown error occurred.';
      console.error('An unknown error occurred.');
      break;
  }
  console.error('YouTube Player Error:', errorMsg);
}

watchEffect(async () => {
  if (selectedVideo.value) {
    if (!player) {
      // wait 1ms
      await new Promise(resolve => setTimeout(resolve, 1));
      console.log('Creating new player for video ID:', selectedVideo.value.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player = new ((window as Window).YT as any).Player('yt-frame', {
        height: '300',
        width: '500',
        playerVars: {
          controls: 1,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          playsinline: 1,
        },
        videoId: selectedVideo.value.id,
        events: {
          'onReady': onPlayerReady,
          'onError': onPlayerError,
          'onStateChange': (event: { data: number; }) => {
            if (event.data === 3) {
              console.log('Video buffering');
              if (selectedVideo.value?.seek !== undefined) {
                const fifth = player.getDuration() / 5;
                player.seekTo(fifth * selectedVideo.value.seek, true);
              }
            }
          },
        }
      });
    } else {
      player.loadVideoById(selectedVideo.value.id);
    }
    console.log('Player created', player);
  }
});

</script>

<template>
  <div v-if="!decryptedData">
    <p>No decrypted data available. Please provide a valid passphrase in the URL.</p>
  </div>
  <div v-else>
    <div v-if="selectedVideo" class="player">
      <h2>Now Playing: {{ selectedVideo.title }}</h2>
      <div id="yt-wrapper">
        <div id="yt-frame"></div>
      </div>
    </div>
    <div v-if="selectedVideo" class="player-margin"></div>
    <div v-for="(videos, basename) in videostore.sortedVideosByBasename" :key="basename" style="margin-bottom: 20px;">
      <h3>{{ basename }}</h3>
      <p>Published at: {{ timeString(videos[0].publishedAt) }}</p>
      <div v-for="video in videos" :key="video.id" style="margin-left: 20px; margin-bottom: 10px;">
        <button @click="selectedVideo = video">Part: {{ video.part }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: fixed;
  top: 0px;
  left: 0px;
}

.player-margin {
  height: 320px;
  /* Height of the player + some margin */
}
</style>
