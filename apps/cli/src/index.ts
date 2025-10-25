#!/usr/bin/env node
import { Command } from "commander";
import { handleDigest } from "./commands/digest";
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
  .action(async (options) => {
    await handleDigest({
      since: options.since,
      limit: options.limit,
      format: options.format,
      includeRawEvents: options.includeRawEvents
    });
  });

program
  .command("pr-draft")
  .description("Generate a pull request draft from staged changes")
  .option("--max-lines <count>", "Limit diff lines", (value) => Number.parseInt(value, 10))
  .action((options) => {
    handlePrDraft({ maxLines: options.maxLines });
  });

program.parseAsync(process.argv);
