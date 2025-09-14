<script setup lang="ts">
import { ref } from 'vue';
import { useSecretStore } from './stores/secretstore';
import { useVideoStore } from './stores/videostore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { computed } from 'vue';

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
    if (dataObj.playlist_id) {
      videostore.setPlaylistID(dataObj.playlist_id);
      console.log('Set playlist ID in videostore:', dataObj.playlist_id);
    } else {
      console.warn('No playlist_id found in decrypted data');
    }
  }).catch((err) => {
    console.error('Decryption failed:', err);
  });
}

</script>

<template>
  <div v-if="!decryptedData">
    <p>No decrypted data available. Please provide a valid passphrase in the URL.</p>
  </div>
  <div v-else>
    <p>Decrypted Data: {{ decryptedData }}</p>
  </div>
</template>

<style scoped></style>
