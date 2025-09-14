// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { decryptPayload } from './secrets/decrypt';

export const useSecretStore = defineStore('secret', () => {
  const passphrase = ref(null as string | null);

  function setPassphrase(p: string) {
    passphrase.value = p;
  }
  function getPassphrase() {
    return passphrase.value;
  }

  async function decryptData(fileName: string) {
    if (!passphrase.value) {
      console.warn('Passphrase not set');
      return;
    }
    // Read the encrypted data from ./secrets/encrypted/*.json
    let data;
    try {
      data = (await import(`./secrets/encrypted/${fileName}.json`)) as {
        iter: number; salt: string; iv: string; ct: string;
      };
    } catch (error) {
      throw new Error(`No data found for file: ${fileName}: ${error}`);
    }
    // Decrypt the data using the passphrase
    const decrypted = await (await decryptPayload(data).catch((err) => {
      throw new Error('Decryption failed. ' + (err as Error).message);
    }))(passphrase.value).catch((err) => {
      throw new Error('Decryption failed. ' + (err as Error).message);
    });
    // You may want to store decrypted data somewhere, e.g. in a ref
    // decryptedData.value = decrypted;
    return decrypted;
  }

  return { decryptData, setPassphrase, getPassphrase }
})
