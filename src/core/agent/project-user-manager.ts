/**
 * Per-project Linux user (v2.4, C.1).
 *
 * Each project gets its own system user so one project can never read another's
 * files. Creating a user needs sudo, so it is a two-stage flow: an explicit approval
 * callback must return true, and any failure after creation rolls the user back.
 */

import type { VpsExecResult } from '@shared/vps'
import { shellQuote } from '@shared/shell-quote'

export interface ProjectUserDeps {
  exec(serverId: string, command: string): Promise<VpsExecResult>
  /** Must resolve true to proceed with sudo useradd. */
  approveSudo?(serverId: string, command: string): Promise<boolean>
  audit?(entry: { ok: boolean; detail: string }): Promise<void>
}

export interface ProjectUserResult {
  username: string
  created: boolean
  blocked?: boolean
  logs: string[]
}

const USERNAME_RE = /^aidesk-[a-z0-9]{8}$/

/** `aidesk-<first 8 chars>` — deterministic, safe, never collides across projects. */
export function projectUsername(projectId: string): string {
  const slug = projectId.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `aidesk-${(slug + '00000000').slice(0, 8)}`
}

export function usernameIsSafe(username: string): boolean {
  return USERNAME_RE.test(username)
}

export async function createProjectUser(
  deps: ProjectUserDeps,
  serverId: string,
  project: { id: string; path: string }
): Promise<ProjectUserResult> {
  const logs: string[] = []
  const username = projectUsername(project.id)
  if (!usernameIsSafe(username)) {
    return { username, created: false, logs: [`Unsafe username: ${username}`], blocked: true }
  }

  // 1. Reuse an existing user.
  const exists = await deps.exec(serverId, `id ${shellQuote(username)} 2>/dev/null`)
  if (exists.ok) {
    logs.push(`User ${username} already exists; reusing.`)
    return { username, created: false, logs }
  }

  // 2. Creating it needs sudo, which needs approval. v2.6.5: the gate is
  // mandatory and fails closed — it used to be `if (deps.approveSudo)`, so any
  // caller that did not wire the hook ran `sudo useradd` with no prompt.
  if (!deps.approveSudo) {
    return {
      username,
      created: false,
      logs: ['Refusing to create a system user without a configured sudo approval gate.'],
      blocked: true
    }
  }
  const approved = await deps.approveSudo(serverId, `useradd -m ${username}`)
  if (!approved) {
    return { username, created: false, logs: ['Sudo approval denied.'], blocked: true }
  }

  const create = await deps.exec(
    serverId,
    `sudo useradd -m -s /bin/bash ${shellQuote(username)}`
  )
  if (!create.ok) {
    return { username, created: false, logs: [`useradd failed: ${first(create)}`] }
  }
  logs.push(`Created user ${username}`)

  // 3. Give the project directory to the new user; roll back the user on failure.
  const chown = await deps.exec(
    serverId,
    `sudo chown -R ${shellQuote(`${username}:${username}`)} ${shellQuote(project.path)}`
  )
  if (!chown.ok) {
    const rollback = await deps.exec(serverId, `sudo userdel -r ${shellQuote(username)}`)
    logs.push(rollback.ok ? `chown failed; rolled back user ${username}.` : 'chown and rollback failed.')
    await deps.audit?.({ ok: false, detail: `project user ${username} rollback` })
    return { username, created: false, logs }
  }
  logs.push(`Chowned ${project.path} to ${username}`)

  await deps.audit?.({ ok: true, detail: `created project user ${username}` })
  return { username, created: true, logs }
}

function first(result: VpsExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
}

/** Remove a project's Linux user (and its home), with the same sudo gate. */
export async function removeProjectUser(
  deps: ProjectUserDeps,
  serverId: string,
  projectId: string
): Promise<ProjectUserResult> {
  const logs: string[] = []
  const username = projectUsername(projectId)
  if (!usernameIsSafe(username)) {
    return { username, created: false, logs: [`Unsafe username: ${username}`], blocked: true }
  }
  // v2.6.5: same mandatory, fail-closed sudo gate as creation — `userdel -r`
  // deletes the user's home directory.
  if (!deps.approveSudo) {
    return {
      username,
      created: false,
      logs: ['Refusing to remove a system user without a configured sudo approval gate.'],
      blocked: true
    }
  }
  const approved = await deps.approveSudo(serverId, `userdel -r ${username}`)
  if (!approved) {
    return { username, created: false, logs: ['Sudo approval denied.'], blocked: true }
  }
  const result = await deps.exec(serverId, `sudo userdel -r ${shellQuote(username)}`)
  if (!result.ok) {
    return { username, created: false, logs: [`userdel failed: ${first(result)}`] }
  }
  logs.push(`Removed user ${username}`)
  await deps.audit?.({ ok: true, detail: `removed project user ${username}` })
  return { username, created: false, logs }
}

