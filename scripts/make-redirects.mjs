// Writes src/stores/secrets/encrypted/<choir>.json.json = {"redirect": <new link>}
// encrypted with that choir's OLD passphrase (the one old links carry), in the
// format src/stores/secrets/decrypt.ts reads (PBKDF2-SHA256 + AES-GCM-256).
//
// Usage: node scripts/make-redirects.mjs <newlinks.json> [rawDir]
//   newlinks.json: {"jm": "https://stemmanauhat.vilpponen.fi/?user=jm&passphrase=...", ...}
//                  A link of "PENDING" sends that choir to the new site's root.
//   rawDir:        holds <choir>.json with the old "passphrase" (default
//                  src/stores/secrets/raw, git-ignored). Never commit either file.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";

const NEW_SITE = "https://stemmanauhat.vilpponen.fi/";
const ITER = 300000;
const ENC_DIR = "src/stores/secrets/encrypted";

const [linksPath, rawDir = "src/stores/secrets/raw"] = process.argv.slice(2);
if (!linksPath) {
  console.error("Usage: node scripts/make-redirects.mjs <newlinks.json> [rawDir]");
  process.exit(1);
}
const links = JSON.parse(readFileSync(linksPath, "utf8"));

for (const [choir, link] of Object.entries(links)) {
  const redirect = link === "PENDING" ? NEW_SITE : link;
  if (typeof redirect !== "string" || !redirect.startsWith(NEW_SITE)) {
    throw new Error(`${choir}: link must start with ${NEW_SITE}`);
  }
  const { passphrase } = JSON.parse(readFileSync(join(rawDir, `${choir}.json`), "utf8"));
  if (!passphrase) throw new Error(`${choir}: no "passphrase" in ${rawDir}/${choir}.json`);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, ITER, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify({ redirect }), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const payload = {
    v: 1, kdf: "PBKDF2-SHA256", iter: ITER, algo: "AES-GCM-256",
    salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"),
  };
  writeFileSync(join(ENC_DIR, `${choir}.json.json`), JSON.stringify(payload));
  console.log(`${choir}: ${link === "PENDING" ? "PENDING, sends to the new site's root" : "new link encrypted"}`);
}
