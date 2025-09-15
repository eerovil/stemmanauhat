<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSecretStore } from './stores/secretstore';
import { useVideoStore } from './stores/videostore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { computed } from 'vue';
import type { ExtendedVideo } from './stores/videostore';

const secretstore = useSecretStore();
const videostore = useVideoStore();

const decryptedData = ref<string | null>(null);

// Parse query parameters
const urlParams = new URLSearchParams(window.location.search);
const user = urlParams.get('user') || 'default';
const passphraseFromPath = urlParams.get('passphrase') || '';

if (passphraseFromPath) {
  secretstore.setPassphrase(passphraseFromPath);
  secretstore.decryptData(`${user}.json`).then((decrypted) => {
    decryptedData.value = new TextDecoder().decode(decrypted);
    const dataObj = JSON.parse(decryptedData.value);
    if (dataObj.videos) {
      videostore.setVideos(dataObj.videos);
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
function detectMobile() {
  const ua = navigator.userAgent || navigator.vendor;
  const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
  return /android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua) || isSmallScreen;
}
const videoHeight = ref(320);
const fullScreen = ref(false);
const handleOrientation = async () => {
  // Wait 500 ms to allow orientation change to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  // Initialize video height based on 16:9 aspect ratio
  videoHeight.value = window.innerWidth * (12 / 16);
  let landscape = window.screen.orientation.type.startsWith('landscape');
  const isMobile = detectMobile();
  if (!isMobile) {
    console.log('Not a mobile device, forcing portrait mode');
    landscape = false;
  }
  if (landscape) {
    console.log('Landscape orientation');
    fullScreen.value = true;
    if (videoHeight.value > window.innerHeight) {
      videoHeight.value = window.innerHeight;
    }
  } else {
    fullScreen.value = false;
    const maxHeight = window.innerHeight * 0.7;
    if (videoHeight.value > maxHeight) {
      videoHeight.value = maxHeight;
    }
  }
  console.log('Orientation changed, video height set to:', videoHeight);
  // Set player height if player exists
  if (player) {
    player.setSize(window.innerWidth, videoHeight);
  } else {
    console.log('Player not initialized yet');
  }
};
handleOrientation();
window.screen.orientation.onchange = handleOrientation;

watch(selectedVideo, async (newVideo) => {
  if (newVideo) {
    if (!player) {
      // wait 1ms
      await new Promise(resolve => setTimeout(resolve, 1));
      console.log('Creating new player for video ID:', newVideo.id);
      console.log("videoHeight:", videoHeight);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player = new ((window as Window).YT as any).Player('yt-frame', {
        height: videoHeight.value.toString(),
        width: window.innerWidth.toString(),
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
        videoId: newVideo.id,
        events: {
          'onReady': onPlayerReady,
          'onError': onPlayerError,
          'onStateChange': (event: { data: number; }) => {
            if (event.data === 3) {
              if (player.getCurrentTime() > 0) {
                return;
              }
              console.log('Video buffering');
              if (selectedVideo.value?.seek !== undefined) {
                const fifth = player.getDuration() / 5;
                player.seekTo((fifth * selectedVideo.value.seek), true);
              }
            }
          },
        }
      });
    } else {
      player.loadVideoById(newVideo.id);
    }
    console.log('Player created', player);
  }
});

if (user) {
  // Set favicon to user.ico
  const link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
  if (link) {
    link.href = `${user}.ico`;
  } else {
    const newLink = document.createElement('link');
    newLink.rel = 'icon';
    newLink.href = `${user}.ico`;
    document.getElementsByTagName('head')[0].appendChild(newLink);
  }
}

</script>

<template>
  <div v-if="!decryptedData">
    <p>No decrypted data available. Please provide a valid passphrase in the URL.</p>
  </div>
  <div v-else>
    <div v-if="selectedVideo" class="player">
      <span v-if="!fullScreen">{{ selectedVideo.title }}</span>
      <div id="yt-wrapper">
        <div id="yt-frame"></div>
      </div>
    </div>
    <div v-if="selectedVideo" class="player-margin" :style="`margin-top: ${videoHeight}px`"></div>
    <div v-for="(videos, basename) in videostore.sortedVideosByBasename" :key="basename" class="video-group">
      <h3>{{ basename }}</h3>
      <span>{{ timeString(videos[0].publishedAt) }}</span>
      <div class="video-button-wrapper">
        <div v-if="videos.find(v => v.part === 'Kaikki')" class="video-button video-button-all">
          <button @click="selectedVideo = (videos.find(v => v.part === 'Kaikki') as ExtendedVideo)">Kaikki</button>
        </div>
        <div class="other-videos">
          <div v-for="video in videos.filter(v => v.part !== 'Kaikki')" :key="video.id" class="video-button">
            <button @click="selectedVideo = video">{{ video.part }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
}
</style>
<style scoped>
.player {
  position: fixed;
  top: 0px;
  left: 0px;
  background-color: black;
  color: white;
  width: 100%;
  height: 320px;

  text-align: center;
  padding: 0.5rem 0 0 0;
}

.player>span {
  display: block;
  font-size: 1rem;
  margin-bottom: 0.5rem;
}

.player-margin {
  height: 100px;
}

.video-group>h3 {
  margin: 0;
}

.video-group {
  padding: 0.5rem;
}

.video-group:nth-child(2n) {
  background-color: #f0f0f0;
}

.video-button-wrapper {
  display: flex;
}

.other-videos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
  width: 100%;
}

.video-button {
  flex: 1;
}

.video-button button {
  width: 100%;
  height: 3rem;
  font-size: 1rem;
}

.video-button-all {
  flex: 1 1 50%;
  margin-right: 0.5rem;
}
</style>
