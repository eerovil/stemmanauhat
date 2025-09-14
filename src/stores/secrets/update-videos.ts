import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decryptPayload } from "./decrypt"; // your existing function

type EncryptedPayload = {
  v: number;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string; // base64
  iv: string;   // base64
  ct: string;   // base64 (ciphertext || tag)
  algo: "AES-GCM-256";
};

type PlainData = {
  playlist_id: string;
  video_ids: string[]; // current list we want to refresh
  // ...anything else you store
};

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
let PASSPHRASE = '';
const PBKDF2_ITER = Number(process.env.SECRETS_PBKDF2_ITER || 300_000);

if (!YOUTUBE_API_KEY) throw new Error("Missing env YOUTUBE_API_KEY");

async function fetchPlaylistVideoIds(playlistId: string): Promise<string[]> {
  let pageToken: string | undefined = undefined;
  const all: string[] = [];

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", YOUTUBE_API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
    const data = await res.json();
    for (const item of data.items || []) {
      const vid = item?.contentDetails?.videoId;
      if (vid) all.push(vid);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Stable sort/dedup
  const dedup = Array.from(new Set(all));
  dedup.sort(); // so commits only happen on real changes
  return dedup;
}

function encryptPBKDF2(plaintextBytes: Uint8Array): EncryptedPayload {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(PASSPHRASE, "utf8"), salt, PBKDF2_ITER, 32, "sha256");

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ctWithTag = Buffer.concat([ciphertext, tag]);

  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: PBKDF2_ITER,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ctWithTag.toString("base64"),
    algo: "AES-GCM-256",
  };
}

async function readEncrypted(user: string): Promise<EncryptedPayload> {
  const p = path.resolve(process.cwd(), `./src/stores/secrets/encrypted/${user}.json.json`);
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function writeEncrypted(user: string, payload: EncryptedPayload) {
  const p = path.resolve(process.cwd(), `./src/stores/secrets/encrypted/${user}.json.json`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(payload));
}

function bytesToUtf8(b: Uint8Array) { return new TextDecoder().decode(b); }
function utf8ToBytes(s: string) { return new TextEncoder().encode(s); }

function normalizeIds(ids: string[]): string[] {
  const uniq = Array.from(new Set(ids));
  uniq.sort();
  return uniq;
}

export async function updateVideoIds(user: string): Promise<"unchanged" | "updated"> {
  PASSPHRASE = process.env[`${user.toUpperCase()}_PASSPHRASE`] || "";
  if (!PASSPHRASE) throw new Error(`Missing env ${user.toUpperCase()}_PASSPHRASE`);
  // 1) load + decrypt
  const enc = await readEncrypted(user);
  const decryptFn = await decryptPayload({
    iter: enc.iter, salt: enc.salt, iv: enc.iv, ct: enc.ct
  } as never);
  const plaintextBytes = await decryptFn(PASSPHRASE);
  const current: PlainData = JSON.parse(bytesToUtf8(plaintextBytes));

  if (!current.playlist_id) throw new Error("Plain data missing playlist_id");

  // 2) fetch latest from YT
  const latestIds = await fetchPlaylistVideoIds(current.playlist_id);
  console.log(`[update-videos] ${user}: fetched ${latestIds.length} videos from playlist ${current.playlist_id}`);

  // 3) compare
  const prev = normalizeIds(current.video_ids || []);
  const next = normalizeIds(latestIds);

  const changed = prev.length !== next.length || prev.some((v, i) => v !== next[i]);
  if (!changed) return "unchanged";

  // 4) write back (re-encrypt)
  const updated: PlainData = { ...current, video_ids: next };
  const payload = encryptPBKDF2(utf8ToBytes(JSON.stringify(updated)));
  await writeEncrypted(user, payload);
  return "updated";
}

/* CLI for local dev & CI:
   pnpm tsx src/scripts/update-videos.ts user1 user2 ...
*/
const users = process.argv.slice(2);
if (users.length === 0) {
  console.error("Usage: tsx src/scripts/update-videos.ts <user> [user2 ...]");
  process.exit(2);
}
(async () => {
  let anyUpdated = false;
  for (const u of users) {
    const res = await updateVideoIds(u).catch(e => {
      console.error(`[update-videos] ${u}:`, (e as Error).message);
      process.exitCode = 1;
      return "unchanged" as const;
    });
    console.log(`[update-videos] ${u}: ${res}`);
    if (res === "updated") anyUpdated = true;
  }
  // Exit code 0 either way; workflow will check git diff to decide commit.
  if (anyUpdated) console.log("[update-videos] Some users updated.");
})();
