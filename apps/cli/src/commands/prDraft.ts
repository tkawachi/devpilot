import { execSync } from "node:child_process";

interface PrDraftOptions {
  maxLines?: number;
}

export function handlePrDraft(options: PrDraftOptions = {}): void {
  const diff = getStagedDiff();
  const draft = draftFromDiff(diff, options);
  console.log(`# ${draft.title}\n\n${draft.body}`);
}

function getStagedDiff(): string {
  try {
    return execSync("git diff --staged", { encoding: "utf8" });
  } catch {
    return "";
  }
}

function draftFromDiff(diff: string, options: PrDraftOptions) {
  const maxLines = options.maxLines ?? 100;
  if (!diff.trim()) {
    return { title: "chore: empty diff", body: "No staged changes." };
  }
  const lines = diff.split("\n").slice(0, maxLines);
  return {
    title: "feat: PR draft (auto)",
    body: [
      "## Summary",
      "- Auto-drafted from staged diff",
      "```diff",
      ...lines,
      "```"
    ].join("\n")
  };
}
