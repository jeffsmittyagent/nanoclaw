# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Fork-Specific Customizations (Preserve on Upstream Merges)

This fork adds features not in upstream NanoClaw. When merging from `upstream/main`, verify these are not overwritten:

### `containerConfig.envVars` — third-party credential pass-through

**Files:** `src/container-runner.ts`, `src/types.ts`

Upstream NanoClaw only injects Anthropic credentials into containers. This fork adds an `envVars` field to `ContainerConfig` that names `.env` vars to pass through as container environment variables — used by groups like TimeHound that need third-party API credentials (Zoho, etc.).

`src/types.ts` must have:
```ts
export interface ContainerConfig {
  envVars?: string[]; // Names of .env vars to pass through into the container
  // ...
}
```

`src/container-runner.ts` must have:
1. `import { readEnvFile } from './env.js';` in the imports
2. `envVars?: string[]` parameter on `buildContainerArgs`
3. Pass-through block inside `buildContainerArgs` (after auth mode, before `hostGatewayArgs`):
```ts
if (envVars && envVars.length > 0) {
  const secrets = readEnvFile(envVars);
  for (const key of envVars) {
    const val = process.env[key] || secrets[key];
    if (val) args.push('-e', `${key}=${val}`);
  }
}
```
4. Call site passes `group.containerConfig?.envVars` as the fourth argument to `buildContainerArgs`

This was broken by an upstream merge (`5591f21`) that replaced the entire `buildContainerArgs` function.

### Credential proxy retry loop — indefinite retry

**File:** `src/index.ts`

The upstream proxy retry loop gives up after 60 seconds. This fork changes it to retry indefinitely at 5-second intervals. This is necessary because `bridge100` only comes up when the first container VM starts (which can be minutes after NanoClaw boots), and a fixed cap causes the proxy to give up before any container ever runs. The loop must use `while (true)` with no max-attempts cap and a 5-second sleep between `EADDRNOTAVAIL` failures.

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

**Bot not responding after reboot / `EADDRNOTAVAIL 192.168.64.1:3001`:** Apple Container's bridge interface (`bridge100`) only comes up when a container VM starts — it does not exist at boot. The credential proxy (`src/credential-proxy.ts`) binds to this IP, so it cannot start until the first container runs. NanoClaw handles this with a background retry loop that retries every 5 seconds indefinitely — the proxy will bind automatically once the first container brings up `bridge100`. Ensure the Apple Container daemon is running: `container system start`.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
