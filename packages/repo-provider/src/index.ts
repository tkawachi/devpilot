import os from "os";
import path from "path";

import {
  ensureBareRepository,
  prepareClone,
  prepareWorktree,
  type RepoOptions
} from "./git";
import { cleanupExpiredDirectories, touch } from "./fs-utils";
import { normalizeLogger, type Logger } from "./logger";
import { probeRepository, type ProbeResult } from "./probe";

export type PreparationMode = "worktree" | "clone";

export interface PrepareRepositoryOptions extends RepoOptions {
  runProbe?: boolean;
  requireProbeSuccess?: boolean;
  cleanupTTL?: {
    worktrees?: number;
    clones?: number;
  };
}

export interface RepositoryPreparation {
  cwd: string;
  mode: PreparationMode;
  probe?: ProbeResult;
}

export async function prepareRepository(
  options: PrepareRepositoryOptions
): Promise<RepositoryPreparation> {
  const log = normalizeLogger(options.logger);
  const bareDirectory = options.bareDirectory ?? path.join(os.homedir(), ".vk-clones");
  const bare = await ensureBareRepository(
    options.repoUrl,
    options.logger,
    bareDirectory,
    options.env
  );

  await maybeCleanup(options, log);

  const runProbe = options.runProbe !== false;
  const requireProbeSuccess = options.requireProbeSuccess !== false;

  if (options.cleanupTTL?.worktrees && options.worktreeDirectory) {
    await touch(options.worktreeDirectory);
  }

  try {
    const worktreePath = await prepareWorktree({ ...options, bare });
    let probe: ProbeResult | undefined;
    if (runProbe) {
      probe = await probeRepository({
        cwd: worktreePath,
        logger: options.logger,
        env: options.env
      });
      if (!probe.ok && requireProbeSuccess) {
        log.warn(
          `[repo-provider] worktree probe failed; falling back to clone for ${worktreePath}`
        );
      } else {
        await touch(worktreePath);
        log.info(`[repo-provider] using worktree at ${worktreePath}`);
        return { cwd: worktreePath, mode: "worktree", probe };
      }
    } else {
      await touch(worktreePath);
      log.info(`[repo-provider] using worktree at ${worktreePath}`);
      return { cwd: worktreePath, mode: "worktree" };
    }
  } catch (error: unknown) {
    log.warn(
      `[repo-provider] worktree preparation failed: ${(error as Error).message}`
    );
  }

  const clonePath = await prepareClone({ ...options, bare });
  let cloneProbe: ProbeResult | undefined;
  if (runProbe) {
    cloneProbe = await probeRepository({
      cwd: clonePath,
      logger: options.logger,
      env: options.env
    });
  }
  await touch(clonePath);
  log.info(`[repo-provider] using clone at ${clonePath}`);
  return { cwd: clonePath, mode: "clone", probe: cloneProbe };
}

export interface CleanupOptions {
  worktreeDirectory?: string;
  cloneDirectory?: string;
  ttlMs: number;
  logger?: Logger;
}

export async function cleanupWorkspaces(options: CleanupOptions): Promise<string[]> {
  const log = normalizeLogger(options.logger);
  const removed: string[] = [];
  if (options.worktreeDirectory && options.ttlMs > 0) {
    const worktrees = await cleanupExpiredDirectories(
      options.worktreeDirectory,
      options.ttlMs
    );
    worktrees.forEach((entry) =>
      log.info(`[repo-provider] removed expired worktree ${entry}`)
    );
    removed.push(...worktrees);
  }

  if (options.cloneDirectory && options.ttlMs > 0) {
    const clones = await cleanupExpiredDirectories(
      options.cloneDirectory,
      options.ttlMs
    );
    clones.forEach((entry) =>
      log.info(`[repo-provider] removed expired clone ${entry}`)
    );
    removed.push(...clones);
  }

  return removed;
}

async function maybeCleanup(
  options: PrepareRepositoryOptions,
  log: Required<Logger>
): Promise<void> {
  const ttl = options.cleanupTTL;
  if (!ttl) {
    return;
  }

  if (ttl.worktrees && options.worktreeDirectory) {
    const removed = await cleanupExpiredDirectories(
      options.worktreeDirectory,
      ttl.worktrees
    );
    removed.forEach((dir) =>
      log.info(`[repo-provider] cleaned expired worktree ${dir}`)
    );
  }

  if (ttl.clones && options.cloneDirectory) {
    const removed = await cleanupExpiredDirectories(
      options.cloneDirectory,
      ttl.clones
    );
    removed.forEach((dir) =>
      log.info(`[repo-provider] cleaned expired clone ${dir}`)
    );
  }
}

export { probeRepository } from "./probe";
export type { ProbeResult } from "./probe";
export { cleanupExpiredDirectories } from "./fs-utils";
export type { Logger } from "./logger";
