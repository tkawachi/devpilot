#!/usr/bin/env node
import { Command } from "commander";
import { handleDigest } from "./commands/digest";
import { handleCollect } from "./commands/collect";
import { handlePrDraft } from "./commands/prDraft";

const program = new Command();
program
  .name("devpilot")
  .description("Developer productivity toolkit");

program
  .command("digest")
  .description("Collect repository activity and generate a digest")
  .requiredOption("--since <window>", "Time window to inspect, e.g. '24h'")
  .option("--limit <count>", "Maximum number of events", (value) => Number.parseInt(value, 10))
  .option("--format <format>", "Output format (json|text)", "json")
  .option("--no-include-raw-events", "Exclude raw event list from output")
  .option("--notify <mode>", "Notifier to use (slack|macos)", (value) => {
    const normalized = value.toLowerCase();
    if (normalized !== "slack" && normalized !== "macos") {
      throw new Error(`Invalid notifier mode: ${value}`);
    }
    return normalized;
  })
  .option("--slack-token <token>", "Slack bot token for notifications")
  .option("--slack-channel <channel>", "Slack channel to post digest notifications")
  .option("--mac-title <title>", "Title for macOS notification center alerts")
  .option("--mac-subtitle <subtitle>", "Subtitle for macOS notifications")
  .option("--mac-sound <sound>", "macOS notification sound name")
  .action(async (options) => {
    await handleDigest({
      since: options.since,
      limit: options.limit,
      format: options.format,
      includeRawEvents: options.includeRawEvents,
      notify: options.notify,
      slackToken: options.slackToken,
      slackChannel: options.slackChannel,
      macTitle: options.macTitle,
      macSubtitle: options.macSubtitle,
      macSound: options.macSound
    });
  });

program
  .command("pr-draft")
  .description("Generate a pull request draft from staged changes")
  .option("--max-lines <count>", "Limit diff lines", (value) => Number.parseInt(value, 10))
  .action((options) => {
    handlePrDraft({ maxLines: options.maxLines });
  });

program
  .command("collect")
  .description("Start the workspace event collector")
  .option("--interval <ms>", "Polling interval in milliseconds", (value) => Number.parseInt(value, 10))
  .action(async (options) => {
    await handleCollect({ interval: options.interval });
  });

program.parseAsync(process.argv);
