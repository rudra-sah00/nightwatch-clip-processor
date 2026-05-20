import { copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const CLIPS_DIR = "/tmp/clips";

/**
 * Filesystem-based storage for clip segments.
 * Reads directly from the shared /tmp/clips volume where the backend writes segments.
 */
export const storage = {
  async listKeys(prefix: string): Promise<string[]> {
    const dir = join(CLIPS_DIR, prefix);
    try {
      const files = await readdir(dir);
      return files.sort().map((f) => `${prefix}${f}`);
    } catch {
      return [];
    }
  },

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const srcPath = join(CLIPS_DIR, key);
    await copyFile(srcPath, destPath);
  },

  async deletePrefix(prefix: string): Promise<void> {
    const dir = join(CLIPS_DIR, prefix);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  },
};
