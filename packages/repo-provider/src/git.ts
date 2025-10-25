import { createHash } from "crypto";
import os from "os";
import path from "path";

import { runCommand } from "./exec";
import { ensureDir, pathExists, removeDir } from "./fs-utils";
import { normalizeLogger, type Logger } from "./logger";

export interface BareRepository {
  path: string;
  repoHash: string;
}

export interface RepoOptions {
  repoUrl: string;
  taskId: string;
  bareDirectory?: string;
  worktreeDirectory?: string;
  cloneDirectory?: string;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
}

export async function ensureBareRepository(
  repoUrl: string,
  logger?: Logger,
  baseDir = path.join(os.homedir(), ".vk-clones"),
  env?: NodeJS.ProcessEnv
): Promise<BareRepository> {
  const log = normalizeLogger(logger);
  const repoHash = createHash("sha1").update(repoUrl).digest("hex");
  const barePath = path.join(baseDir, `${repoHash}.git`);

  await ensureDir(baseDir);

  if (!(await pathExists(barePath))) {
    log.info(`[repo-provider] creating bare cache ${barePath}`);
    const clone = await runCommand("git", [
      "clone",
      "--bare",
      "--filter=blob:none",
      repoUrl,
      barePath
    ], { env });
    if (clone.code !== 0) {
      throw new Error(
        `Failed to clone bare repository: ${clone.stderr || clone.stdout}`
      );
    }
  } else {
    log.debug?.(`[repo-provider] reusing bare cache ${barePath}`);
  }

  // Ensure the remote URL is correct and fetch the latest changes.
  await runCommand("git", ["remote", "set-url", "origin", repoUrl], {
    cwd: barePath,
    env
  });
  const fetch = await runCommand("git", ["fetch", "origin", "--prune"], {
    cwd: barePath,
    env
  });
  if (fetch.code !== 0) {
    throw new Error(`Failed to fetch bare repository: ${fetch.stderr}`);
  }

  return { path: barePath, repoHash };
}

export async function prepareWorktree(
  options: RepoOptions & { bare: BareRepository }
): Promise<string> {
  const { bare, repoUrl, taskId, logger, worktreeDirectory, env } = options;
  const log = normalizeLogger(logger);
  const baseDir = worktreeDirectory ?? path.join(os.tmpdir(), "vk-worktrees");
  const targetDir = path.join(baseDir, bare.repoHash, taskId);
  const branchName = `vk/${taskId}`;

  await ensureDir(path.dirname(targetDir));

  // Clean up stale worktree if present.
  await runCommand("git", ["worktree", "prune"], { cwd: bare.path, env });
  const worktreeList = await runCommand("git", ["worktree", "list", "--porcelain"], {
    cwd: bare.path,
    env
  });
  if (worktreeList.code === 0 && worktreeList.stdout.includes(targetDir)) {
    await runCommand("git", ["worktree", "remove", "--force", targetDir], {
      cwd: bare.path,
      env
    });
  }

  if (await pathExists(targetDir)) {
    await removeDir(targetDir);
  }

  await ensureDir(baseDir);

  // Ensure branch points to origin/HEAD before creating the worktree.
  const branch = await runCommand(
    "git",
    ["branch", "-f", branchName, "origin/HEAD"],
    { cwd: bare.path, env }
  );
  if (branch.code !== 0) {
    throw new Error(`Failed to update branch ${branchName}: ${branch.stderr}`);
  }

  const add = await runCommand(
    "git",
    ["worktree", "add", "--force", targetDir, branchName],
    { cwd: bare.path, env }
  );

  if (add.code !== 0) {
    throw new Error(`Failed to create worktree: ${add.stderr}`);
  }

  // Make sure remote URL is correct for the worktree checkout.
  await runCommand("git", ["remote", "set-url", "origin", repoUrl], {
    cwd: targetDir,
    env
  });

  log.info(`[repo-provider] prepared worktree ${targetDir}`);
  return targetDir;
}

export async function prepareClone(
  options: RepoOptions & { bare: BareRepository }
): Promise<string> {
  const { bare, repoUrl, taskId, logger, cloneDirectory, env } = options;
  const log = normalizeLogger(logger);
  const baseDir = cloneDirectory ?? path.join(os.tmpdir(), "vk-clones");
  const targetDir = path.join(baseDir, `${bare.repoHash}-${taskId}`);
  const branchName = `vk/${taskId}`;

  await ensureDir(baseDir);

  if (!(await pathExists(targetDir))) {
    const cloneArgs = [
      "clone",
      "--filter=blob:none",
      "--reference-if-able",
      bare.path,
      repoUrl,
      targetDir
    ];
    const cloneResult = await runCommand("git", cloneArgs, { env });
    if (cloneResult.code !== 0) {
      throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
    }
  } else {
    log.debug?.(`[repo-provider] reusing clone ${targetDir}`);
    await runCommand("git", ["remote", "set-url", "origin", repoUrl], {
      cwd: targetDir,
      env
    });
    const fetch = await runCommand(
      "git",
      ["fetch", "origin", "--prune"],
      { cwd: targetDir, env }
    );
    if (fetch.code !== 0) {
      throw new Error(`Failed to fetch clone ${targetDir}: ${fetch.stderr}`);
    }
  }

  const checkout = await runCommand(
    "git",
    ["checkout", "-B", branchName, "origin/HEAD"],
    { cwd: targetDir, env }
  );
  if (checkout.code !== 0) {
    throw new Error(`Failed to checkout branch ${branchName}: ${checkout.stderr}`);
  }

  await runCommand("git", ["reset", "--hard", "origin/HEAD"], {
    cwd: targetDir,
    env
  });
  await runCommand("git", ["clean", "-xfd"], { cwd: targetDir, env });

  log.info(`[repo-provider] prepared clone ${targetDir}`);
  return targetDir;
}
