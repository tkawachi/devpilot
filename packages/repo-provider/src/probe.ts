import { promises as fs } from "fs";
import path from "path";

import { runCommand, type CommandResult } from "./exec";
import { normalizeLogger, type Logger } from "./logger";

export interface ProbeCommandSummary extends CommandResult {}

export interface ProbeResult {
  ok: boolean;
  commands: ProbeCommandSummary[];
  plugins: string[];
  reason?: string;
}

export interface ProbeOptions {
  cwd: string;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
}

export async function probeRepository(options: ProbeOptions): Promise<ProbeResult> {
  const { cwd, logger, env } = options;
  const log = normalizeLogger(logger);

  const commands: ProbeCommandSummary[] = [];
  let reason: string | undefined;

  const about = await runCommand("sbt", ["-batch", "about"], { cwd, env });
  commands.push(about);
  log.info(`[repo-provider] sbt about exited with ${about.code}`);
  if (about.code !== 0) {
    reason =
      about.stderr ||
      about.stdout ||
      about.error?.message ||
      "sbt about failed";
  }

  const headCommit = await runCommand(
    "sbt",
    ["-batch", "show git.gitHeadCommit"],
    { cwd, env }
  );
  commands.push(headCommit);
  log.info(`[repo-provider] sbt gitHeadCommit exited with ${headCommit.code}`);
  if (reason === undefined && headCommit.code !== 0) {
    reason =
      headCommit.stderr ||
      headCommit.stdout ||
      headCommit.error?.message ||
      "sbt gitHeadCommit failed";
  }

  const plugins = await inspectPlugins(cwd, log);

  const ok = about.code === 0 && headCommit.code === 0;

  if (ok) {
    log.info(`[repo-provider] probe succeeded; found plugins: ${plugins.join(", ") || "<none>"}`);
  } else {
    log.warn(`[repo-provider] probe failed: ${reason}`);
  }

  return { ok, commands, plugins, reason };
}

async function inspectPlugins(cwd: string, log: Required<Logger>): Promise<string[]> {
  try {
    const pluginFile = path.join(cwd, "project", "plugins.sbt");
    const contents = await fs.readFile(pluginFile, "utf8");
    const matches = Array.from(contents.matchAll(/addSbtPlugin\(([^)]+)\)/g));
    return matches.map((match) => match[1].trim());
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.warn(`[repo-provider] failed to inspect plugins: ${(error as Error).message}`);
    }
    return [];
  }
}
