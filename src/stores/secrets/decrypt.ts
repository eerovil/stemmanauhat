export async function decryptPayload(payload: {
  iter: number; salt: string; iv: string; ct: string;
}) {
  const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(pass: string) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(payload.salt), iterations: payload.iter, hash: "SHA-256" },
      km,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  return async (passphrase: string) => {
    const key = await deriveKey(passphrase);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64(payload.iv), tagLength: 128 },
      key,
      b64(payload.ct)
    );
    return new Uint8Array(pt); // convert/parse as needed
  };
}
