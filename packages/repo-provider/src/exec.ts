import { spawn } from "child_process";

export interface CommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code: number | null;
  durationMs: number;
  error?: Error;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const finish = (code: number | null, error?: Error) => {
      resolve({
        command,
        args,
        stdout,
        stderr,
        code,
        durationMs: Date.now() - start,
        error
      });
    };

    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code ?? null));
  });
}
