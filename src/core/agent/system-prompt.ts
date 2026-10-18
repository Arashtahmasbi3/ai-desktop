/**
 * The agent system prompt and its postscripts (F0-4 extraction).
 *
 * Pure string building: the provider it runs in, the tools it was offered, and the
 * remote/diagnostic/task-planning guidance. No dependency on the orchestrator, so it
 * stays unit-testable on its own (test/core/remote-guidance.test.ts and friends).
 */
import type { SandboxProvider } from '@shared/sandbox'
import type { ToolDefinition } from '@shared/types'
import { PLAN_MODE_HINT } from './approval'
import { PLAN_SYSTEM_PROMPT } from './plan-mode'

function summarizeTools(tools: ToolDefinition[]): string {
  return tools
    .map((tool) => {
      const props = (tool.parameters as { properties?: Record<string, { description?: string }> })
        .properties
      const args = props
        ? Object.entries(props)
            .map(([name, schema]) => `${name}${schema.description ? `: ${schema.description}` : ''}`)
            .join(', ')
        : ''
      return `- ${tool.name}(${args})\n  ${tool.description}`
    })
    .join('\n')
}

/**
 * Concrete run context baked into the prompt (v2.5.3, Smarter Prompt) so the
 * model can answer "which project am I on?" from what it already knows instead
 * of spending tool calls re-discovering it.
 */
export interface RemotePromptContext {
  projectName?: string
  projectPath?: string
  vpsId?: string
  vpsName?: string
  environment?: string
}

export interface SystemPromptOptions {
  /** A remote VPS is in play, so remote discovery/loop rules apply (v2.5.3). */
  remote?: boolean
  /** Diagnostic Mode is currently active (read-only system access). */
  diagnosticEnabled?: boolean
  /** Active project/VPS/environment shown to the model (v2.5.3). */
  remoteContext?: RemotePromptContext
  /** The `diagnose_crash` tool is available, so teach the diagnosis workflow. */
  crashDiagnosis?: boolean
  /** Teach the multi-step task-planning and alternative-strategy workflow. */
  taskPlanning?: boolean
}

/**
 * Guidance appended to the system prompt for remote/VPS work (v2.5.3, Fix 3).
 *
 * The v2.5.2 tool cards made a specific failure visible: the agent probed
 * `/etc/os-release` and `/proc/loadavg` (blocked by P0-2) and re-tried a path
 * that did not exist instead of discovering the real layout. This block teaches
 * the two habits that fix it — discover before acting, and change strategy after
 * a block — plus what to use when Diagnostic Mode is off.
 */
export function buildRemoteGuidance(
  diagnosticEnabled = false,
  context?: RemotePromptContext,
  crashDiagnosis = false,
  taskPlanning = false
): string {
  const contextBlock = context
    ? [
        '## Context awareness (already known - do NOT spend tool calls re-discovering)',
        context.projectName ? `- Project: ${context.projectName}` : '',
        context.projectPath ? `- Path: ${context.projectPath}` : '',
        context.vpsName || context.vpsId
          ? `- VPS: ${context.vpsName ?? context.vpsId}` +
            `${context.vpsName && context.vpsId ? ` (${context.vpsId})` : ''}`
          : '',
        context.environment ? `- Environment: ${context.environment}` : '',
        'Answer a question about any of these directly from this context instead of ' +
          'making tool calls. Only call tools when you need new information from the host.'
      ]
        .filter(Boolean)
        .join('\n')
    : [
        '## Context awareness',
        'The current project, its path, the VPS and the environment are shown in the chat',
        'header. For a simple question about them, answer from that context instead of',
        'making tool calls. Only call tools when you need new information from the host.'
      ].join('\n')
  return `# Remote diagnostics (VPS / remote project)
You are working on a remote host. Follow these habits.

## Discover the project layout before acting
- Never assume \`package.json\` (or any manifest) sits at the project root; it is
  commonly under \`apps/\`, \`packages/\`, \`services/\` or \`src/\`.
- Find it first, then read it:
  \`find <projectRoot> -maxdepth 3 -name package.json 2>/dev/null\`
- Use \`list_dir\` on the project root before guessing nested paths.

## Read-only system facts (allowed without a path)
- \`uname -a\` kernel, \`hostname\` server name, \`uptime\` load average
- \`free -h\` memory, \`df -h\` disk, \`nproc\` CPUs
- \`systemctl status <service>\` service state
These carry no path argument and are always permitted.

## If a path is blocked
The project root is confined (P0-2). A message like
\`Blocked: Path "..." is outside project root\` means the target is off-limits.
- Do NOT retry the same path; it will be blocked again.
- Use a whitelisted command above, or stay inside the project root.
- If you truly need logs or \`/proc\`, ask the user to enable Diagnostic Mode.

## If a file is not found
Do NOT assume where it lives. Run \`find\` (or \`list_dir\`) first, then act on the
real path.

${
  crashDiagnosis
    ? `## Crash diagnosis workflow
When the user asks about a crash, an error or a service being down:
1. FIRST call the \`diagnose_crash\` tool. It runs the standard read-only probes
   (process managers, logs, resources, network) and collects the evidence for you.
2. THEN report in two sections:
   - **Evidence**: the key outputs from the probes.
   - **Diagnosis**: the probable cause, a confidence level (HIGH/MEDIUM/LOW) and
     concrete recommendations.
3. NEVER guess without evidence, never claim the project is healthy without
   checking, and do not invent complex shell one-liners yourself.
4. If \`diagnose_crash\` is not enough, ask the user before reaching further:
   "Should I check log file X?" or "Enable Diagnostic Mode so I can read the
   system logs."

Example report:
\`\`\`
== Evidence ==
- PM2: app is errored (15 restarts)
- Memory: 3.7/4 GB used (92%)
- Disk: 45% used
- No OOM events detected

== Diagnosis ==
Cause: pm2_process_error (confidence: HIGH)
Summary: PM2 logs show repeated restarts
Recommendations:
- Check: pm2 logs <app> --err
- Increase the memory limit in ecosystem.config.js
- Review recent changes for a memory leak
\`\`\``
    : ''
}

${contextBlock}

${
  taskPlanning
    ? `## Task Planning (CRITICAL)
For a task with MORE THAN ONE step:
1. FIRST plan: state the goal and list 3-7 concrete steps (what + which tool +
   expected outcome).
2. Present the plan to the user for approval before executing it.
3. Execute step by step. After each step check success; if it failed, try an
   alternative (below); if there is no alternative, STOP and ask the user.

## Alternative Strategies
If a command fails, change approach — do NOT retry the same call:
- "pm2: command not found" -> \`systemctl --failed\` or \`docker ps -a\`
- "permission denied"        -> \`journalctl -n 50\` or \`dmesg | tail -50\`
- "path blocked"             -> a whitelisted command (\`uname -a\`, \`free -h\`, \`df -h\`)
- "no such file"             -> \`find\` / \`list_dir\` first
- "timeout"                  -> inspect the process with \`ps\`

NEVER retry the same command more than twice. After 2 failed attempts: STOP and
either try a DIFFERENT approach or ASK THE USER.

## Progress Tracking
- Success: proceed to the next step.
- Failure with an alternative: try the alternative.
- Failure without an alternative: STOP and report to the user.`
    : ''
}

${
  diagnosticEnabled
    ? `## Diagnostic Mode: ON (read-only, ~30 min)
You may read \`/var/log\`, \`/root/.pm2/logs\`, \`/proc\`, \`/etc/os-release\` and
other allowed system paths to diagnose a crash. Read-only — never write there.`
    : `## Diagnostic Mode: OFF
System paths (\`/var/log\`, \`/proc\`, \`/etc/os-release\`, \`journalctl\`) are
blocked. Use the whitelisted commands above, or ask the user to enable
Diagnostic Mode in Settings for a crash investigation.`
}`
}

export function buildSystemPrompt(
  provider: SandboxProvider,
  tools: ToolDefinition[],
  systemHint?: string,
  options: SystemPromptOptions = {}
): string {
  return `You are AI Desktop, an autonomous coding agent working inside a sandbox.

# Environment
- You operate inside a "${provider}" workspace with the tools listed below. When that workspace is
  the user's project folder, read and list its files and run its commands in place; every write lands
  on disk immediately. You still cannot browse the rest of their computer, so never claim you opened
  a path outside the workspace unless a tool actually read it.
- Files the user attaches in the chat ARE copied into your workspace under "attachments/". Read them
  with \`read_file\` using that workspace-relative path (for example "attachments/report.pdf").
- Every path you use must be relative to the workspace root (for example "hello.txt", "src/app.js").
  An absolute host path such as "C:\\Users\\..." is always refused.
- Network access is disabled by default.
${systemHint ? `\n# Remote access\n${systemHint}\n` : ''}
# Available tools
${summarizeTools(tools)}

# How you work (repeat until the task is done)
1. Planning  - decide the single next step that moves the task forward.
2. Execution - call one or more tools. Batch independent calls in one turn.
3. Observation - read the tool results that are returned to you. Never invent results.
4. Reflection - judge whether the task is complete.

# Finishing
When the task is complete, reply with a short summary and make NO tool calls.
If you are blocked, explain what you need from the user and make NO tool calls.

# Rules
- Do not repeat an action that already succeeded.
- If an action failed, correct the arguments before retrying.
- Prefer write_file to create files and run_command to execute them.
- Reply in the same language the user wrote in (Persian or English).
${options.remote ? `\n${buildRemoteGuidance(options.diagnosticEnabled, options.remoteContext, options.crashDiagnosis, options.taskPlanning)}\n` : ''}`
}

export interface RunPromptOptions {
  provider: SandboxProvider
  tools: ToolDefinition[]
  planMode: boolean
  systemHint?: string
  /** A plan gate is wired with an approval mode other than `full`. */
  planGateEnabled: boolean
  /** `remote_shell` is exposed, so the run targets a VPS. */
  remoteWork: boolean
  diagnosticEnabled: boolean
  crashDiagnosis: boolean
  remoteContext?: RemotePromptContext
}

/**
 * The system prompt for one run: which postscript (plan mode, plan approval, plain)
 * applies is decided here, so the orchestrator only supplies the facts (F0-4).
 */
export function buildRunSystemPrompt(options: RunPromptOptions): string {
  const planHints = [options.systemHint]
  if (options.planGateEnabled) planHints.push(PLAN_SYSTEM_PROMPT)
  const hint = options.planMode
    ? [options.systemHint, PLAN_MODE_HINT].filter(Boolean).join('\n\n')
    : planHints.filter(Boolean).join('\n\n')
  return buildSystemPrompt(options.provider, options.tools, hint, {
    remote: options.remoteWork,
    diagnosticEnabled: options.diagnosticEnabled,
    crashDiagnosis: options.crashDiagnosis,
    taskPlanning: options.remoteWork,
    ...(options.remoteContext ? { remoteContext: options.remoteContext } : {})
  })
}
