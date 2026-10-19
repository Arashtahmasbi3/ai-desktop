# Capability matrix

The honest state of every capability this application claims. **Read this before believing a feature list.**

`state` is one of:

- **real** — a user can do it, and a test proves the behaviour (not just that the code runs);
- **partial** — it works, with a stated limit. The limit is written in the row, not hidden here;
- **absent** — named so nobody reinvents it, or so the missing half is visible.

`proven by` names the test that would fail if the capability stopped working. A row without one is a claim, and this
document exists because claims rot.

## Agent loop

| capability | state | configured where | proven by |
|---|---|---|---|
| Plan → execute → observe → reflect loop | real | always on | `test/agent/orchestrator.test.ts` |
| Loop detection with a stop verdict | real | automatic | `test/core/verdict-patterns.test.ts` |
| The verdict names one of 12 causes + a next step | real | automatic | `test/core/verdict-patterns.test.ts` |
| Context compaction at a token budget | real | provider capability | `test/agent/context-manager.test.ts` |
| Run resumption from a stored session | real | Sessions | `test/agent/session-store.test.ts` |
| Plan mode (approve before acting) | real | Settings → run mode | `test/agent/plan-mode.test.ts` |
| Decision checkpoints | partial | off by default | `test/agent/decision-gate.test.ts` — a decision is logged and can pause a run, but it is **not reviewable after the fact**: there is no queue, so a user cannot revisit one (B2-4, needs an explicit product decision) |

## Tools the model can be offered

| capability | state | configured where | proven by |
|---|---|---|---|
| File tools (`read_file`, `write_file`, `list_dir`, `search_files`) | real | automatic | `test/agent/tools.test.ts` |
| `run_command` in a sandbox | real | automatic | `test/agent/orchestrator.test.ts` |
| `ask_user` with 1–6 suggested answers, continuing the same run | real | automatic | `test/core/ask-user-options.test.ts` |
| `use_skill` — load a `SKILL.md` body on demand | real | `skills/` on disk | `test/main/skills-run.test.ts` |
| MCP server tools as `mcp__<server>__<tool>` | real | Settings → MCP | `test/main/mcp-run.test.ts` |
| One place assembles a run's tools | real | — | `test/core/toolset.test.ts` |

## Remote (the user's own servers)

| capability | state | configured where | proven by |
|---|---|---|---|
| SSH with host-key verification | real | Settings → Connections | `test/main/ssh-manager.test.ts` |
| `remote_shell` on a connected server | real | per run | `test/main/remote-runtime*.test.ts` |
| Remote file tools over SFTP: `remote_read_file`, `remote_write_file`, `remote_list_dir`, `remote_exists`, `remote_grep`, `remote_git_status` | real | per run | `test/main/agent-service-remote-fs*.test.ts` |
| `worktree_list` — read-only worktree inspection | real | per run | `test/core/worktree*.test.ts` |
| `diagnose_crash` and the named diagnostics (`get_service_logs`, `get_disk_usage`, `get_system_health`, `get_process_list`) | real | per run | `test/core/diagnostics-*.test.ts` |
| `list_servers`, and server references by id, name or host | real | automatic | `test/core/server-ref*.test.ts` |
| `migrate_project` between two servers | real | per run | `test/core/migrate-project*.test.ts` |
| Per-host command policy (read-only / staging / production) | real | Settings → Connections | `test/core/host-policy.test.ts` |
| Connection test, offered where a failure is felt | real | sidebar / status bar | `test/renderer/connection-test-reachability.test.tsx` |

## Approvals and safety

| capability | state | configured where | proven by |
|---|---|---|---|
| Approval modes (`ask` / `auto-write` / `full`) | real | Settings → approvals | `test/agent/approval.test.ts` |
| Read-only commands skip the prompt, derived from one list | real | automatic | `test/core/approval-readonly.test.ts` |
| Deny list, path containment, secret-path guard | real | automatic | `test/security/penetration.test.ts` |
| Network actions asked about in their own words | real | automatic | `test/security/network-action.test.ts` |
| A scoped, expiring server grant | real | approval dialog | `test/security/server-grant.test.ts` |
| Hash-chained audit trail | real | automatic | `test/core/audit-log.test.ts` |
| MCP tools never ride on "auto-approve" | real | automatic | `test/main/mcp-run.test.ts` |
| Code signing of the installer | **absent** | — | deferred to the public release (O4-1) |

## Spend and memory

| capability | state | configured where | proven by |
|---|---|---|---|
| Daily spend cap that refuses before the call | real | Settings → usage | `test/main/spend*.test.ts` |
| An unpriced model reported as a lower bound | real | — | `test/main/spend*.test.ts` |
| Usage dashboard (days, providers, models) | real | Settings → usage | `test/renderer/*usage*.test.tsx` |
| Project fact ledger with validity windows | real | Settings → memory | `test/core/facts*.test.ts` |

## Interface

| capability | state | configured where | proven by |
|---|---|---|---|
| Brutalist design system, enforced | real | `main.css` tokens | `test/renderer/brutal-tokens.test.ts` |
| Light and dark themes with a contrast contract | real | Settings → appearance | `test/renderer/theme-tokens.test.ts` |
| Persian (RTL) and English, key parity | real | Settings → language | `test/renderer/i18n.test.ts` |
| Visible simple/advanced switch | real | status bar | `test/renderer/ui-mode.test.tsx` |
| Three display levels (inline → expanded → full screen) | real | — | `test/renderer/disclosure-*.test.tsx` |
| Empty states with at most two actions | real | — | `test/renderer/empty-state.test.tsx` |
| Every icon-only button has an accessible name | real | — | `test/renderer/icon-button-a11y.test.ts` |
| A review queue for the agent's consequential decisions | **absent** | — | needs an explicit product decision (B2-4) |

## Operations

| capability | state | configured where | proven by |
|---|---|---|---|
| Auto-update with a checksum-verified installer | real | Settings → about | `test/main/updater*.test.ts` |
| A debug port in a packaged build, off by default | partial | `--remote-debugging-port` / env | `test/main/debug-port.test.ts` — the flag is tested, the packaged runtime is not exercised on this machine |
| A reproducible release script | real | `npm run release` | `test/main/release-script.test.ts` |
| CI with screenshot diffing in both themes | **absent** | — | O4-4, not built |

## How this document stays true

`test/docs/capability-matrix.test.ts` fails when a tool the agent can be offered is missing from this file, and when
a `partial` row has no stated limit. A capability that is added without a row here is a capability nobody can audit.
