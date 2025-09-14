/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type { Plugin, ViteDevServer } from "vite";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import * as crypto from "node:crypto";

/* ---------------- Helpers ---------------- */

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import("fs").Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(rootDir);
  return out;
}

function encryptBufferPBKDF2(
  passphrase: string,
  buf: Buffer,
  iterations: number
) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, iterations, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ctWithTag = Buffer.concat([ciphertext, tag]);

  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: iterations,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ctWithTag.toString("base64"),
    algo: "AES-GCM-256",
  };
}

async function encryptTree(opts: {
  rawDir: string;
  encDir: string;
  passphrase: string;
  iterations: number;
}) {
  const { rawDir, encDir, passphrase, iterations } = opts;
  await fs.mkdir(encDir, { recursive: true });
  const files = await listFilesRecursive(rawDir);

  await Promise.all(
    files.map(async (absSrc) => {
      const rel = path.relative(rawDir, absSrc);
      const dstPath = path.join(encDir, rel) + ".json";
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      const buf = await fs.readFile(absSrc);
      const payload = encryptBufferPBKDF2(passphrase, buf, iterations);
      await fs.writeFile(dstPath, JSON.stringify(payload));
    })
  );
}

async function pruneStale(opts: { rawDir: string; encDir: string }) {
  const { rawDir, encDir } = opts;
  const raw = await listFilesRecursive(rawDir);
  const keep = new Set(raw.map((p) => path.relative(rawDir, p) + ".json"));
  const enc = await listFilesRecursive(encDir);
  await Promise.all(
    enc.map(async (abs) => {
      const rel = path.relative(encDir, abs);
      if (!keep.has(rel) && abs.endsWith(".json")) {
        await fs.unlink(abs).catch(() => { });
      }
    })
  );
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let t: NodeJS.Timeout | null = null;
  return ((...args: unknown[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

/* ---------------- Plugin ---------------- */

export type EncryptSecretsOptions = {
  rawDir?: string;          // default: stores/secrets/raw
  encDir?: string;          // default: stores/secrets/encrypted
  iterations?: number;      // default: process.env.SECRETS_PBKDF2_ITER || 300000
  prune?: boolean;          // remove stale encrypted files (default from env SECRETS_PRUNE=1)
  debounceMs?: number;      // dev debounce (default 200)
  watchProject?: boolean;   // watch whole project (true) or just rawDir (false). default true
  failOnMissingPassphraseDev?: boolean; // default false (warn instead)
};

export default function EncryptSecrets(options: EncryptSecretsOptions = {}): Plugin {
  const RAW_DIR = path.resolve(process.cwd(), options.rawDir ?? "src/stores/secrets/raw");
  const ENC_DIR = path.resolve(process.cwd(), options.encDir ?? "src/stores/secrets/encrypted");
  const ITER = Number(options.iterations ?? process.env.SECRETS_PBKDF2_ITER ?? 300000);
  const PRUNE = options.prune ?? (process.env.SECRETS_PRUNE === "1");
  const DEBOUNCE_MS = options.debounceMs ?? 200;
  const WATCH_PROJECT = options.watchProject ?? true;

  const ignorePrefixes = [
    path.resolve(process.cwd(), "node_modules") + path.sep,
    path.resolve(process.cwd(), ".git") + path.sep,
    ENC_DIR + path.sep,
  ];

  const getPass = () => process.env.SECRETS_PASSPHRASE || "";

  async function fullEncrypt(logger: { info: Function; error: Function }) {
    const pass = getPass();
    if (!pass) {
      logger.info("[encrypt-secrets] SECRETS_PASSPHRASE not set; skipping encryption.");
      return;
    }
    await encryptTree({ rawDir: RAW_DIR, encDir: ENC_DIR, passphrase: pass, iterations: ITER });
    if (PRUNE) await pruneStale({ rawDir: RAW_DIR, encDir: ENC_DIR });
    logger.info(`[encrypt-secrets] Encrypted ${RAW_DIR} -> ${ENC_DIR} (iter=${ITER})`);
  }

  function shouldIgnore(absPath: string): boolean {
    const p = path.resolve(absPath) + (absPath.endsWith(path.sep) ? "" : "");
    return ignorePrefixes.some((pref) => p.startsWith(pref));
  }

  /* Vite plugin object */
  return {
    name: "encrypt-secrets",
    enforce: "pre",

    // Build: one full pass before bundling
    async buildStart() {
      await fullEncrypt({
        info: (m: unknown) => this.warn(String(m)),
        error: (m: unknown) => this.error(String(m)),
      });
    },

    // Dev: initial pass + re-encrypt all on any change (debounced)
    configureServer(server: ViteDevServer) {
      const pass = getPass();
      if (!pass) {
        const msg = "[encrypt-secrets] SECRETS_PASSPHRASE not set; skipping dev encryption.";
        if (options.failOnMissingPassphraseDev) throw new Error(msg);
        server.config.logger.warn(msg);
        return;
      }

      fullEncrypt(server.config.logger).catch((e) =>
        server.config.logger.error(`[encrypt-secrets] initial: ${e?.message || e}`)
      );

      const onAny = debounce((...args: unknown[]) => {
        const absPath = args[1] as string | undefined;
        if (absPath && shouldIgnore(absPath)) return;
        fullEncrypt(server.config.logger).catch((e) =>
          server.config.logger.error(`[encrypt-secrets] ${e?.message || e}`)
        );
      }, DEBOUNCE_MS);

      const watcher = server.watcher;
      if (WATCH_PROJECT) {
        watcher.on("all", onAny); // whole project
      } else {
        watcher.add(path.join(RAW_DIR, "**/*"));
        watcher.on("all", onAny); // just rawDir
      }
    },
  };
}
