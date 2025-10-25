# devpilot
AI-assisted development toolkit（CLI + GitHub App の土台）。最初は PRドラフト生成と通知の“収束レイヤー”から。

## CLI digest notifications

```
pnpm devpilot digest --since 24h --notify macos --mac-title "DevPilot" --mac-sound Ping
```

`--notify macos` sends the digest to the macOS notification center, applying any `--mac-title`, `--mac-subtitle`, or `--mac-sound` overrides. Slack credentials such as `--slack-token` or `--slack-channel` are ignored when macOS notifications are selected.

## Event collector

```
pnpm devpilot collect
```

This boots a long-running poller that records new `.vk/*.log` entries, repository commits, and task metadata into `events.db`. Use `--interval <ms>` to adjust the polling cadence (default 120 000 ms).
