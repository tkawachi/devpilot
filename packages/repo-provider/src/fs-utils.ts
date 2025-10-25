import { promises as fs } from "fs";
import path from "path";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function removeDir(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export async function touch(target: string): Promise<void> {
  const time = new Date();
  try {
    await fs.utimes(target, time, time);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function cleanupExpiredDirectories(
  baseDir: string,
  ttlMs: number
): Promise<string[]> {
  const removed: string[] = [];
  if (!(await pathExists(baseDir))) {
    return removed;
  }

  const entries = await fs.readdir(baseDir);
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(baseDir, entry);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory() && now - stats.mtimeMs > ttlMs) {
        await removeDir(fullPath);
        removed.push(fullPath);
      }
    })
  );

  return removed;
}
