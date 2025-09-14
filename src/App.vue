<script setup lang="ts">
import { ref } from 'vue';
import { useSecretStore } from './stores/secretstore';
import { computed } from 'vue';

const decryptedData = ref<string | null>(null);
const secretstore = useSecretStore();
const passphrase = computed({
  get: () => secretstore.getPassphrase(),
  set: (val: string) => {
    secretstore.setPassphrase(val);
    secretstore.decryptData('jm.json').then((decrypted) => {
      decryptedData.value = new TextDecoder().decode(decrypted);
      console.log('Decrypted data:', decryptedData.value);
    }).catch((err) => {
      decryptedData.value = "failed to decrypt";
      console.error('Decryption failed:', err);
    });
  }
});

</script>

<template>
  <input placeholder="give passphrase" v-model="passphrase" />
  <p>Decrypted Data: {{ decryptedData }}</p>
</template>

<style scoped></style>
