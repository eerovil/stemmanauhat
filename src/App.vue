<script setup lang="ts">
import { ref, reactive, watch, computed, nextTick } from 'vue';
import { useSecretStore } from './stores/secretstore';
import { useVideoStore } from './stores/videostore';
import type { ExtendedVideo } from './stores/videostore';
import {
  type Crop,
  type CropPresets,
  IDENTITY_CROP,
  emptyPresets,
  resolveCrop,
} from './crop';

const secretstore = useSecretStore();
const videostore = useVideoStore();

const decryptedData = ref<string | null>(null);

// Parse query parameters
const urlParams = new URLSearchParams(window.location.search);
const user = urlParams.get('user') || 'default';
const passphraseFromPath = urlParams.get('passphrase') || '';

const storageKey = (suffix: string) => `secret-webpage-${user}-${suffix}`;

if (passphraseFromPath) {
  secretstore.setPassphrase(passphraseFromPath);
  secretstore.decryptData(`${user}.json`).then((decrypted) => {
    decryptedData.value = new TextDecoder().decode(decrypted);
    const dataObj = JSON.parse(decryptedData.value);
    if (dataObj.videos) {
      videostore.setVideos(dataObj.videos);
      loadCropPresets(dataObj.cropPresets);
      loadLastPractisedSnapshot();
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
const searchQuery = ref('');
const expandedBasename = ref<string | null>(null);

function getPreferredVoiceFromLast(): string | null {
  try {
    const raw = localStorage.getItem(storageKey('last'));
    if (!raw) return null;
    const { part } = JSON.parse(raw) as { part?: string };
    return part ?? null;
  } catch {
    return null;
  }
}
const preferredVoice = ref<string | null>(getPreferredVoiceFromLast());

function saveLastPractised(video: ExtendedVideo) {
  try {
    const payload = { basename: video.basename, part: video.part };
    localStorage.setItem(storageKey('last'), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Snapshot of "last" at page load – used only for the "Jatka siitä" button so it doesn’t change during the session. */
const initialLastPractised = ref<{ basename: string; part: string } | null>(null);

function loadLastPractisedSnapshot() {
  try {
    const raw = localStorage.getItem(storageKey('last'));
    if (!raw) return;
    const obj = JSON.parse(raw) as { basename?: string; part?: string };
    if (obj.basename && obj.part) {
      initialLastPractised.value = { basename: obj.basename, part: obj.part };
    }
  } catch {
    /* ignore */
  }
}

/** If part is like S1-1, return S1; else return part. Used to fall back when a song has no S1-1. */
function basePart(part: string): string {
  const base = part.replace(/-\d+$/, '');
  return base !== part ? base : part;
}

/** True if this part should show the "my part" highlight (exact match or base match, e.g. S1 when preferred is S1-1). */
function isMyPart(preferred: string | null, part: string): boolean {
  if (!preferred) return false;
  return preferred === part || basePart(preferred) === part;
}

/** Find video by exact part, or by base part (e.g. S1 when stored part is S1-1). Store is never changed. */
function findVideoForPart(
  group: ExtendedVideo[],
  part: string
): ExtendedVideo | undefined {
  let video = group.find((v) => v.part === part);
  if (!video) {
    const fallback = basePart(part);
    if (fallback !== part) video = group.find((v) => v.part === fallback);
  }
  return video;
}

function restoreLastPractised(snapshot?: { basename: string; part: string } | null) {
  try {
    const data = snapshot ?? (() => {
      const raw = localStorage.getItem(storageKey('last'));
      if (!raw) return null;
      return JSON.parse(raw) as { basename: string; part: string };
    })();
    if (!data?.basename || !data.part) return;
    const group = videostore.videosByBasename[data.basename];
    if (!group) return;
    const video = findVideoForPart(group, data.part);
    if (!video) return;
    preferredVoice.value = data.part;
    expandedBasename.value = data.basename;
    selectedVideo.value = video;
    nextTick(() => scrollExpandedIntoView(data.basename));
  } catch {
    /* ignore */
  }
}

function selectVideo(video: ExtendedVideo) {
  preferredVoice.value = video.part;
  selectedVideo.value = video;
  saveLastPractised(video);
}

/** Song list ordering. */
const sortMode = ref<'name' | 'date'>('name');

const filteredVideosByBasename = computed(() => {
  let entries = Object.entries(videostore.videosByBasename);
  if (sortMode.value === 'date') {
    // Newest first by the group's upload date.
    entries = entries.slice().sort(
      (a, b) => new Date(b[1][0].publishedAt).getTime() - new Date(a[1][0].publishedAt).getTime(),
    );
  } else {
    entries = entries.slice().sort((a, b) => a[0].localeCompare(b[0], 'fi'));
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) entries = entries.filter(([basename]) => basename.toLowerCase().includes(q));
  return Object.fromEntries(entries);
});

const totalCount = computed(() => Object.keys(videostore.videosByBasename).length);
const filteredCount = computed(() => Object.keys(filteredVideosByBasename.value).length);

/** While a song is open, show ONLY that song so the user can't scroll away. */
const displayedGroups = computed(() => {
  if (selectedVideo.value && expandedBasename.value) {
    const g = videostore.videosByBasename[expandedBasename.value];
    return g ? { [expandedBasename.value]: g } : {};
  }
  return filteredVideosByBasename.value;
});

const toggleGroup = (basename: string) => {
  if (expandedBasename.value === basename) {
    // Collapse the open song and tear down the player.
    expandedBasename.value = null;
    selectedVideo.value = null;
    if (player?.destroy) { try { player.destroy(); } catch { /* already gone */ } }
    player = null;
    return;
  }
  expandedBasename.value = basename;
  const group = videostore.videosByBasename[basename];
  if (group) {
    const video =
      (preferredVoice.value && findVideoForPart(group, preferredVoice.value)) ??
      group.find((v) => v.part === 'Kaikki');
    if (video) {
      selectedVideo.value = video;
      saveLastPractised(video);
    }
  }
  nextTick(() => scrollExpandedIntoView(basename));
};

function scrollExpandedIntoView(basename: string) {
  const group = document.querySelector(`[data-basename="${CSS.escape(basename)}"]`);
  if (!group) return;
  const wrapper = group.querySelector('.video-button-wrapper');
  if (!wrapper) return;

  const runScroll = () => {
    const rect = wrapper.getBoundingClientRect();
    const videoTop = selectedVideo.value ? playerTotalHeight.value : 0;
    const searchBar = document.querySelector('.search-bar');
    const searchBarHeight = searchBar ? searchBar.getBoundingClientRect().height : 0;
    const padding = 80;
    const minTop = videoTop + searchBarHeight + padding;

    if (rect.top < minTop) {
      window.scrollBy({
        top: rect.top - minTop,
        behavior: 'smooth',
      });
    } else if (rect.bottom > window.innerHeight) {
      window.scrollBy({
        top: rect.bottom - window.innerHeight,
        behavior: 'smooth',
      });
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(runScroll);
  });
}

const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
const isWithinLastWeek = (isoString: string) =>
  Date.now() - new Date(isoString).getTime() < oneWeekMs;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null;

// Add YT type to window
declare global {
  interface Window {
    YT: unknown;
  }
}

/** Tap-to-toggle play/pause, since the YouTube controls are hidden. */
function toggleYtPlayback() {
  if (!player?.getPlayerState) return;
  // YT.PlayerState.PLAYING === 1
  if (player.getPlayerState() === 1) player.pauseVideo();
  else player.playVideo();
}

/** Quick seek by `delta` seconds (negative = back), clamped at 0. */
function seekBy(delta: number) {
  if (!player?.getCurrentTime) return;
  player.seekTo(Math.max(0, player.getCurrentTime() + delta), true);
}

/** Quality ranking, highest -> lowest (matches YT quality strings). */
const QUALITY_ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
/** Cap requests at 1080p: asking for 1440p/4K makes YouTube drop to 480p in
 * this embedded/scaled context, so 1080p is the sweet spot. */
const MAX_QUALITY = 'hd1080';

/** Request the highest available quality that is no higher than MAX_QUALITY. */
function setMaxQuality() {
  const levels = player?.getAvailableQualityLevels?.() ?? [];
  if (!levels.length) return;
  const capIdx = QUALITY_ORDER.indexOf(MAX_QUALITY);
  // levels are highest-first; pick the first one that is <= MAX_QUALITY.
  const pick = levels.find((l: string) => {
    const i = QUALITY_ORDER.indexOf(l);
    return i >= 0 && i >= capIdx;
  });
  if (pick) player?.setPlaybackQuality?.(pick);
}

const onPlayerReady = (event: { target: { playVideo: () => void; }; }) => {
  console.log('Player ready');
  event.target.playVideo();
  setMaxQuality();
  startProgressPolling();
  // The zoom/pan-in is triggered from onStateChange once playback actually starts.
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
/** Crop/zoom is a small-screen feature; on desktop we show the full video. */
const isMobileView = ref(detectMobile());
const videoHeight = ref(320);
/**
 * Supersampling: render the YouTube iframe at >= 1080p and visually scale it
 * down to the display size. YouTube picks stream quality from the iframe's
 * layout size (not the CSS transform), so a large iframe gets a 1080p stream,
 * and the crop then zooms into a high-res source instead of a phone-width one.
 */
const viewportWidth = ref(window.innerWidth);
/**
 * Target ~1080p of *device* pixels. Sizing for more (the iframe's CSS px x
 * devicePixelRatio) makes YouTube over-request 1440p/4K, which phones can't
 * sustain — so it collapses to 480p. 1080p is the reliable sweet spot.
 */
const RENDER_TARGET_DEVICE_W = 1920;
const renderWidth = computed(() => {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(viewportWidth.value, Math.round(RENDER_TARGET_DEVICE_W / dpr));
});
const renderHeight = computed(() =>
  Math.max(1, Math.round(renderWidth.value * (videoHeight.value / Math.max(1, viewportWidth.value)))),
);
/** Factor that scales the high-res iframe back down to the display size. */
const ytScale = computed(() => viewportWidth.value / renderWidth.value);
/** Height of the title row inside .player (padding + span + margin) so spacer matches exactly */
const PLAYER_HEADER_PX = 40;
/** Height reserved for the seek-bar row (shown only when not fullscreen). */
const PLAYER_SEEK_PX = 34;
/** Height reserved for the always-visible zoom-slider row (not fullscreen). */
const PLAYER_ZOOM_PX = 38;
const fullScreen = ref(false);

/* ---------------- Playback / seek bar ---------------- */
const currentTime = ref(0);
const duration = ref(0);
const seeking = ref(false);
let progressTimer: ReturnType<typeof setInterval> | null = null;

/** Dev-only playback-quality badge (so you can confirm HD on a real device). */
const playbackQuality = ref('');
const availableQuality = ref<string[]>([]);
const QUALITY_LABELS: Record<string, string> = {
  highres: '>1080p', hd2160: '2160p', hd1440: '1440p', hd1080: '1080p',
  hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p',
};
const labelOf = (q: string) => QUALITY_LABELS[q] ?? q;
const qualityLabel = computed(() => {
  const cur = playbackQuality.value;
  const top = availableQuality.value.filter(l => l !== 'auto')[0]; // highest-first
  const curStr = !cur || cur === 'unknown' ? '…' : labelOf(cur);
  return top ? `${curStr} / max ${labelOf(top)}` : curStr;
});

/** Poll the player for time/duration (the YT API doesn't push updates). */
function startProgressPolling() {
  if (progressTimer) return;
  progressTimer = setInterval(() => {
    if (!player?.getCurrentTime || seeking.value) return;
    const d = player.getDuration?.() ?? 0;
    if (d) duration.value = d;
    currentTime.value = player.getCurrentTime();
    if (isDev) {
      playbackQuality.value = player.getPlaybackQuality?.() ?? '';
      availableQuality.value = player.getAvailableQualityLevels?.() ?? [];
    }

    // Reverse "exit" pan over the final seconds of the video (mobile only).
    if (isMobileView.value && duration.value > 0) {
      const remaining = duration.value - currentTime.value;
      if (!endPanStarted && !cropAnimating && remaining <= END_PAN_START_BEFORE && remaining > 0) {
        endPanStarted = true;
        startEndPan();
      } else if (endPanStarted && remaining > END_PAN_START_BEFORE) {
        // Scrubbed back out of the end zone — restore the saved crop position.
        endPanStarted = false;
        cropAnimating = false;
        applyCrop(false);
      }
    }
  }, 250);
}

function onSeekInput(e: Event) {
  seeking.value = true; // pause polling so the thumb follows the drag
  currentTime.value = +(e.target as HTMLInputElement).value;
}
function onSeekCommit(e: Event) {
  const t = +(e.target as HTMLInputElement).value;
  player?.seekTo?.(t, true);
  currentTime.value = t;
  seeking.value = false;
  if (t <= 0.5 && isMobileView.value) {
    // Scrubbed back to the start: replay the intro pan-in once playback resumes.
    endPanStarted = false;
    prepareCropForPlayback({ ...crop.value });
  }
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ---------------- Crop / zoom ---------------- */
const isDev = import.meta.env.DEV;
const cropPresets = reactive<CropPresets>(emptyPresets());
const crop = ref<Crop>({ ...IDENTITY_CROP });
const showCropControls = ref(false);
const saveStatus = ref('');
const controlsRef = ref<HTMLElement | null>(null);
const controlsHeight = ref(0);

function loadCropPresets(presets: unknown) {
  const p = (presets ?? {}) as Partial<CropPresets>;
  cropPresets.byPart = p.byPart ?? {};
  cropPresets.bySong = p.bySong ?? {};
}

/** Duration of the horizontal (left-right) pan animation. */
const CROP_ANIM_MS = 3000;
/** Extra hold after playback starts before the pan begins. */
const CROP_ANIM_DELAY_MS = 2000;
/** Horizontal origin the pan starts from (far left) before sliding to target. */
const CROP_PAN_START_X = 0;
/** True while animateCropIn is driving the transform, so the deep watcher
 * doesn't snap it straight to the target and kill the transition. */
let cropAnimating = false;
let cropAnimTimer: ReturnType<typeof setTimeout> | null = null;
/** Crop to zoom into once the freshly selected video actually starts playing. */
let pendingCrop: Crop | null = null;
/** Seconds before the end to begin the reverse pan, and how long it lasts. */
const END_PAN_START_BEFORE = 8;
const END_PAN_MS = 3000;
/** True once the end-of-video reverse pan has been kicked off for this video. */
let endPanStarted = false;

/** Apply the current crop to the YouTube iframe (scale + transform-origin). */
function applyCrop(animate = false) {
  const frame: HTMLIFrameElement | undefined = player?.getIframe?.();
  if (!frame) return;
  frame.style.transition = animate ? `transform ${CROP_ANIM_MS}ms ease-in-out` : 'none';
  frame.style.transformOrigin = `${crop.value.originX}% ${crop.value.originY}%`;
  frame.style.transform = `scale(${crop.value.scale})`;
}

/**
 * Apply the target crop, animating ONLY the horizontal (left-right) pan.
 * Zoom (scale) and the vertical position snap instantly; the horizontal origin
 * starts centered and, after a short hold, slides to the saved position.
 */
function animateCropIn(target: Crop) {
  if (cropAnimTimer) { clearTimeout(cropAnimTimer); cropAnimTimer = null; }
  cropAnimating = true;          // suppress the deep watcher's instant apply
  crop.value = { ...target };    // reflect target in sliders/state
  const frame: HTMLIFrameElement | undefined = player?.getIframe?.();
  if (!frame) { cropAnimating = false; return; } // no iframe yet; onReady retries
  // Instant: zoom + vertical position; horizontal starts centered.
  frame.style.transition = 'none';
  frame.style.transformOrigin = `${CROP_PAN_START_X}% ${target.originY}%`;
  frame.style.transform = `scale(${target.scale})`;
  void frame.getBoundingClientRect();            // flush the start state
  // After the hold, slide the horizontal origin to the target (left-right pan).
  cropAnimTimer = setTimeout(() => {
    const f: HTMLIFrameElement | undefined = player?.getIframe?.();
    if (f) {
      f.style.transition = `transform-origin ${CROP_ANIM_MS}ms ease-in-out`;
      f.style.transformOrigin = `${target.originX}% ${target.originY}%`;
    }
    cropAnimTimer = setTimeout(() => {
      cropAnimating = false;
      applyCrop(false);                          // settle + drop the transition
      cropAnimTimer = null;
    }, CROP_ANIM_MS + 60);
  }, CROP_ANIM_DELAY_MS);
}

/**
 * Reverse pan as the video ends: slide the horizontal origin to fully right
 * over END_PAN_MS. Vertical and zoom are left untouched.
 */
function startEndPan() {
  if (cropAnimTimer) { clearTimeout(cropAnimTimer); cropAnimTimer = null; }
  const frame: HTMLIFrameElement | undefined = player?.getIframe?.();
  if (!frame) return;
  cropAnimating = true; // protect from the deep watcher during the exit pan
  frame.style.transition = `transform-origin ${END_PAN_MS}ms ease-in-out`;
  frame.style.transformOrigin = `100% ${crop.value.originY}%`;
  cropAnimTimer = setTimeout(() => { cropAnimating = false; cropAnimTimer = null; }, END_PAN_MS + 100);
}

/**
 * Hold the iframe fully zoomed out (origin already homed on the target) and
 * remember the target. The zoom/pan-in is deferred until playback actually
 * starts (PLAYING state in onStateChange).
 */
function prepareCropForPlayback(target: Crop) {
  if (cropAnimTimer) { clearTimeout(cropAnimTimer); cropAnimTimer = null; }
  cropAnimating = true;          // keep the deep watcher from applying the target early
  pendingCrop = { ...target };
  crop.value = { ...target };    // sliders reflect the saved values right away
  const frame: HTMLIFrameElement | undefined = player?.getIframe?.();
  if (!frame) return;            // no iframe yet; it defaults to zoomed-out anyway
  frame.style.transition = 'none';
  frame.style.transformOrigin = `${target.originX}% ${target.originY}%`;
  frame.style.transform = 'scale(1)';
}

// Live slider edits (and resizes) apply instantly; skip while animating.
watch(crop, () => { if (!cropAnimating) applyCrop(false); }, { deep: true });

function resetCrop() {
  crop.value = { ...IDENTITY_CROP };
}

async function persistPresets() {
  if (!decryptedData.value) return;
  try {
    const dataObj = JSON.parse(decryptedData.value);
    dataObj.cropPresets = JSON.parse(JSON.stringify(cropPresets));
    const passphrase = secretstore.getPassphrase();
    if (passphrase) dataObj.passphrase = passphrase;
    const res = await fetch('/__save-presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, data: dataObj }),
    });
    if (!res.ok) throw new Error(await res.text());
    decryptedData.value = JSON.stringify(dataObj);
    saveStatus.value = 'Tallennettu ✓ (commitoi muutos)';
  } catch (err) {
    saveStatus.value = 'Tallennus epäonnistui';
    console.error('Preset save failed:', err);
  }
}

function saveCropForSong() {
  if (!selectedVideo.value) return;
  const base = selectedVideo.value.basename;
  if (!cropPresets.bySong[base]) cropPresets.bySong[base] = {};
  cropPresets.bySong[base][selectedVideo.value.part] = { ...crop.value };
  persistPresets();
}

// Keep the layout spacer in sync with the (variable-height) controls panel.
watch([showCropControls, fullScreen, saveStatus], () => {
  nextTick(() => {
    controlsHeight.value =
      showCropControls.value && !fullScreen.value ? (controlsRef.value?.offsetHeight ?? 0) : 0;
  });
});

const playerTotalHeight = computed(
  () => videoHeight.value + PLAYER_HEADER_PX
    + (fullScreen.value ? 0 : PLAYER_SEEK_PX)
    + (!fullScreen.value && isMobileView.value ? PLAYER_ZOOM_PX : 0)
    + controlsHeight.value,
);
const handleOrientation = async () => {
  // Wait 500 ms to allow orientation change to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  // Initialize video height based on 16:9 aspect ratio
  viewportWidth.value = window.innerWidth;
  videoHeight.value = window.innerWidth * (12 / 16);
  let landscape = window.screen.orientation.type.startsWith('landscape');
  const isMobile = detectMobile();
  isMobileView.value = isMobile;
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
  console.log('Orientation changed, video height set to:', videoHeight.value);
  // Set player height if player exists
  if (player) {
    player.setSize(renderWidth.value, renderHeight.value);
    applyCrop();
  } else {
    console.log('Player not initialized yet');
  }
};
handleOrientation();
window.screen.orientation.onchange = handleOrientation;

watch(selectedVideo, async (newVideo) => {
  if (newVideo) {
    // Resolve the crop for this song/part. For an existing player we animate the
    // zoom/pan in now; for a brand-new player onReady does it once the iframe exists.
    currentTime.value = 0; // reset the seek bar for the newly selected video
    endPanStarted = false; // re-arm the end-of-video reverse pan
    if (isMobileView.value) {
      const songParts = (videostore.videosByBasename[newVideo.basename] ?? []).map(v => v.part);
      const target = resolveCrop(cropPresets, newVideo.basename, newVideo.part, songParts);
      prepareCropForPlayback(target); // stay zoomed out; pan in when playback starts
    } else {
      // Desktop: no crop — show the full video.
      pendingCrop = null;
      cropAnimating = false;
      crop.value = { ...IDENTITY_CROP };
      applyCrop(false);
    }
    if (!player) {
      // wait 1ms
      await new Promise(resolve => setTimeout(resolve, 1));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player = new ((window as Window).YT as any).Player('yt-frame', {
        height: renderHeight.value.toString(),
        width: renderWidth.value.toString(),
        playerVars: {
          // Desktop has no crop, so show YouTube's native controls (incl. the
          // quality gear). Mobile keeps them hidden for the custom crop UI.
          controls: isMobileView.value ? 0 : 1,
          disablekb: isMobileView.value ? 1 : 0,
          enablejsapi: 1,
          fs: isMobileView.value ? 0 : 1,
          iv_load_policy: 3,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          playsinline: 1,
        },
        videoId: String(newVideo.id),
        events: {
          'onReady': onPlayerReady,
          'onError': onPlayerError,
          'onStateChange': (event: { data: number; }) => {
            // 1 = PLAYING: kick off the zoom/pan-in for a newly selected video.
            if (event.data === 1) {
              setMaxQuality();
              if (pendingCrop) {
                const target = pendingCrop;
                pendingCrop = null;
                animateCropIn(target);
              }
            }
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
      player.loadVideoById({ videoId: String(newVideo.id), suggestedQuality: MAX_QUALITY });
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
    <div
      v-if="selectedVideo"
      class="player"
      :style="{ height: `${playerTotalHeight}px` }"
    >
      <div v-if="!fullScreen" class="player-title-row">
        <span class="player-title">{{ selectedVideo.title }}</span>
        <button
          type="button"
          class="seek-btn"
          aria-label="Taakse 10 s"
          @click="seekBy(-10)"
        >⟲10</button>
        <button
          type="button"
          class="seek-btn"
          aria-label="Eteen 10 s"
          @click="seekBy(10)"
        >10⟳</button>
        <button
          v-if="isMobileView"
          type="button"
          class="crop-toggle"
          :class="{ active: showCropControls }"
          aria-label="Rajaa / zoomaa"
          @click="showCropControls = !showCropControls"
        >⛶</button>
      </div>
      <div id="yt-wrapper" class="player-yt-wrapper" :style="{ height: `${videoHeight}px` }">
        <!-- Hi-res iframe rendered at >=1080p, scaled down to the display size. -->
        <div
          class="yt-scaler"
          :style="{ width: `${renderWidth}px`, height: `${renderHeight}px`, transform: `scale(${ytScale})` }"
        >
          <div id="yt-frame"></div>
        </div>
        <!-- Mobile only: blocks YouTube's hover/title/end-screen chrome and
             toggles play/pause. Desktop uses YouTube's native controls instead. -->
        <div v-if="isMobileView" class="yt-blocker" @click="toggleYtPlayback"></div>
        <div v-if="isDev" class="quality-badge">{{ qualityLabel }}</div>
      </div>
      <div v-if="!fullScreen" class="seek-bar-row">
        <span class="seek-time">{{ fmtTime(currentTime) }}</span>
        <input
          class="seek-range"
          type="range"
          min="0"
          :max="duration || 0"
          step="0.1"
          :value="currentTime"
          aria-label="Kelaa"
          @input="onSeekInput"
          @change="onSeekCommit"
        />
        <span class="seek-time">{{ fmtTime(duration) }}</span>
      </div>
      <div v-if="!fullScreen && isMobileView" class="crop-zoom-row">
        <label class="crop-slider">
          <span>Zoom</span>
          <input type="range" min="1" max="3" step="0.05" v-model.number="crop.scale" />
        </label>
      </div>
      <div v-if="showCropControls && !fullScreen && isMobileView" ref="controlsRef" class="crop-controls">
        <label class="crop-slider">
          <span>↔</span>
          <input type="range" min="0" max="100" step="1" v-model.number="crop.originX" />
        </label>
        <label class="crop-slider">
          <span>↕</span>
          <input type="range" min="0" max="100" step="1" v-model.number="crop.originY" />
        </label>
        <div class="crop-buttons">
          <button type="button" @click="resetCrop">Nollaa</button>
          <template v-if="isDev">
            <button type="button" @click="saveCropForSong">Tallenna laululle</button>
          </template>
        </div>
        <span v-if="saveStatus" class="crop-status">{{ saveStatus }}</span>
      </div>
    </div>
    <div
      v-if="selectedVideo"
      class="player-margin"
      :style="{ height: `${playerTotalHeight}px` }"
    ></div>
    <div
      v-if="!selectedVideo"
      class="search-bar"
    >
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Hae lauluja..."
        aria-label="Hae lauluja"
        class="search-input"
      />
      <div class="sort-toggle" role="group" aria-label="Järjestä">
        <button
          type="button"
          :class="{ active: sortMode === 'name' }"
          @click="sortMode = 'name'"
        >Nimi</button>
        <button
          type="button"
          :class="{ active: sortMode === 'date' }"
          @click="sortMode = 'date'"
        >Lisätty</button>
      </div>
      <span class="search-count">{{ filteredCount }} / {{ totalCount }} laulua</span>
    </div>
    <button
      v-if="initialLastPractised && !selectedVideo"
      type="button"
      class="continue-button"
      @click="restoreLastPractised(initialLastPractised)"
    >
      Jatka siitä mihin jäit
      <span class="continue-song">{{ initialLastPractised.basename }} ({{ initialLastPractised.part }})</span>
    </button>
    <div
      v-for="(videos, basename) in displayedGroups"
      :key="basename"
      class="video-group"
      :data-basename="basename"
    >
      <header class="video-group-header" @click="toggleGroup(String(basename))">
        <span class="expand-icon" :class="{ collapsed: expandedBasename !== basename }">▸</span>
        <h3>{{ basename }}</h3>
        <span
          v-if="videostore.newestBasenames.has(String(basename)) || isWithinLastWeek(videos[0].publishedAt)"
          class="new-badge"
        >Uusi</span>
        <span class="video-group-date">{{ timeString(videos[0].publishedAt) }}</span>
      </header>
      <div v-show="expandedBasename === basename" class="video-button-wrapper">
        <div v-if="videos.find(v => v.part === 'Kaikki')" class="video-button video-button-all">
          <button
            @click="selectVideo(videos.find(v => v.part === 'Kaikki') as ExtendedVideo)"
            :class="{ 'my-part': isMyPart(preferredVoice, 'Kaikki') }"
          >
            Kaikki
          </button>
        </div>
        <div class="other-videos">
          <div v-for="video in videos.filter(v => v.part !== 'Kaikki')" :key="video.id" class="video-button">
            <button
              @click="selectVideo(video)"
              :class="{ 'my-part': isMyPart(preferredVoice, video.part) }"
            >
              {{ video.part }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="filteredCount === 0 && totalCount > 0" class="no-results">Ei löydetty lauluja hakusanalla &quot;{{ searchQuery }}&quot;</p>
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
  top: 0;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background-color: black;
  color: white;
  width: 100%;
  /* height set inline: videoHeight + title row (PLAYER_HEADER_PX) */
  text-align: center;
  padding: 0.5rem 0 0 0;
  box-sizing: border-box;
}

.player-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
}

.player-title {
  flex: 1;
  min-width: 0;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crop-toggle {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  font-size: 1rem;
  line-height: 1;
  color: white;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
}

.seek-btn {
  flex-shrink: 0;
  height: 2rem;
  padding: 0 0.5rem;
  font-size: 0.85rem;
  line-height: 1;
  color: white;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
}

.seek-bar-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.6rem;
  flex-shrink: 0;
}

.seek-time {
  font-size: 0.75rem;
  color: #ccc;
  font-variant-numeric: tabular-nums;
  min-width: 2.6rem;
  text-align: center;
}

.seek-range {
  flex: 1;
  min-width: 0;
  accent-color: #1a73e8;
  cursor: pointer;
}

.crop-toggle.active {
  background: #1a73e8;
  border-color: #1a73e8;
}

.player-yt-wrapper {
  position: relative;
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

/* High-res render surface, downscaled to fit the wrapper via transform. */
.yt-scaler {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}

/* Dev-only playback-quality readout. */
.quality-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  pointer-events: none;
  padding: 2px 6px;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}

/* Covers the visible video window; sits above the (scaled) iframe so none of
   YouTube's chrome is hoverable/clickable. Tap toggles play/pause instead. */
.yt-blocker {
  position: absolute;
  inset: 0;
  z-index: 3;
  cursor: pointer;
  background: transparent;
}

.crop-zoom-row {
  flex-shrink: 0;
  padding: 0.25rem 0.75rem;
  background: #111;
}

.crop-controls {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  background: #111;
}

.crop-slider {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: #ddd;
}

.crop-slider > span {
  width: 2.5rem;
  flex-shrink: 0;
  text-align: left;
}

.crop-slider input[type='range'] {
  flex: 1;
  min-width: 0;
}

.crop-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.15rem;
}

.crop-buttons button {
  flex: 1;
  min-width: max-content;
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  color: white;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
}

.crop-status {
  font-size: 0.75rem;
  color: #8ab4f8;
}

.player-margin {
  /* height set inline from videoHeight so layout matches fixed player exactly */
  flex-shrink: 0;
}

.search-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem 1rem;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  outline: none;
}

.search-input:focus {
  border-color: #666;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08);
}

.search-count {
  font-size: 0.875rem;
  color: #666;
  white-space: nowrap;
}

.sort-toggle {
  display: flex;
  flex-shrink: 0;
  border: 1px solid #ccc;
  border-radius: 6px;
  overflow: hidden;
}

.sort-toggle button {
  padding: 0.4rem 0.7rem;
  font-size: 0.85rem;
  border: none;
  background: #fff;
  color: #444;
  cursor: pointer;
}

.sort-toggle button + button {
  border-left: 1px solid #ccc;
}

.sort-toggle button.active {
  background: #1a73e8;
  color: #fff;
}

.continue-button {
  display: block;
  width: 100%;
  padding: 0.6rem 1rem;
  margin: 0;
  font-size: 1rem;
  text-align: left;
  color: #1a73e8;
  background: #e8f0fe;
  border: none;
  border-bottom: 1px solid #d2e3fc;
  cursor: pointer;
}

.continue-button:hover {
  background: #d2e3fc;
}

.continue-song {
  display: block;
  font-size: 0.85rem;
  color: #666;
  margin-top: 0.15rem;
}

.video-button button.my-part {
  font-weight: 600;
  border: 2px solid #1a73e8;
  background: #e8f0fe;
}

.video-group-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem 0;
  user-select: none;
}

.video-group-header:hover {
  background: rgba(0, 0, 0, 0.03);
}

.expand-icon {
  font-size: 0.75rem;
  color: #666;
  transition: transform 0.2s ease;
  flex-shrink: 0;
  display: inline-block;
}

.expand-icon.collapsed {
  transform: rotate(0deg);
}

.expand-icon:not(.collapsed) {
  transform: rotate(90deg);
}

.video-group>h3 {
  margin: 0;
  flex: 1;
  font-size: 1.1rem;
}

.new-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: #1a73e8;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.video-group-date {
  font-size: 0.8rem;
  color: #666;
}

.video-group {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #eee;
}

.video-group:nth-child(odd) {
  background-color: #fafafa;
}

.video-group:nth-child(even) {
  background-color: #fff;
}

.no-results {
  padding: 2rem 1rem;
  text-align: center;
  color: #666;
}

.video-button-wrapper {
  display: flex;
}

.other-videos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
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
