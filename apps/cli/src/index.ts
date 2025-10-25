#!/usr/bin/env node
import { execSync } from "node:child_process";

function getStagedDiff() {
  try {
    return execSync("git diff --staged", { encoding: "utf8" });
  } catch {
    return "";
  }
}

function draftFromDiff(diff: string) {
  if (!diff.trim()) {
    return { title: "chore: empty diff", body: "No staged changes." };
  }
  const lines = diff.split("\n").slice(0, 100);
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

const diff = getStagedDiff();
const draft = draftFromDiff(diff);
console.log(`# ${draft.title}\n\n${draft.body}`);
