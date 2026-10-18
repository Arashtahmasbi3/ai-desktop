import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Blocks, Plus, Trash2 } from 'lucide-react'
import type { McpServerInput, McpServerStatus, McpServerView } from '@shared/mcp'

/**
 * Settings → MCP: the servers this machine may spawn, and what the last run saw (F0-2e).
 *
 * The library was already there — a client, a transport, a store and a bridge — but a feature is
 * not a feature until a user can reach it, so this page is the whole of the MCP surface:
 *
 *  - **add** a server (name, command, arguments, optional `KEY=value` environment lines);
 *  - **see** each one with its launch line, whether it is enabled, and either its tool count or
 *    the error the last connection produced;
 *  - **enable / disable** it, which is what makes a run skip the process entirely;
 *  - **remove** it;
 *  - **read the last status**, which is an observation from a real connection rather than a guess:
 *    a server nothing has opened yet says "Disconnected", and that is the truth.
 *
 * What the page never shows is the environment block. A token lives there, so it is written to
 * main and never read back — `McpServerView` is the only shape that crosses the bridge.
 */
export default function SettingsMcp(): JSX.Element {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServerView[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [list, status] = await Promise.all([window.api.mcp.list(), window.api.mcp.status()])
      setServers(Array.isArray(list) ? list : [])
      setStatuses(Array.isArray(status) ? status : [])
    } catch (caught) {
      setError(t('settings.mcpLoadError', { message: messageOf(caught) }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Run one mutation and render the list main answers with. Every MCP channel returns the whole
   * list, so the page never has to guess at the new state, and a failure leaves the previous list
   * on screen instead of blanking it.
   */
  const apply = async (work: () => Promise<McpServerView[]>): Promise<void> => {
    setBusy(true)
    try {
      setServers(await work())
      setStatuses(await window.api.mcp.status())
      setError(null)
    } catch (caught) {
      setError(t('settings.mcpSaveError', { message: messageOf(caught) }))
    } finally {
      setBusy(false)
    }
  }

  const add = (): void => {
    if (name.trim() === '' || command.trim() === '') {
      setFormError(t('settings.mcpInvalidForm'))
      return
    }
    const input: McpServerInput = {
      name: name.trim(),
      command: command.trim(),
      args: splitArgs(args),
      ...(Object.keys(parseEnvLines(env)).length === 0 ? {} : { env: parseEnvLines(env) })
    }
    setFormError(null)
    void apply(() => window.api.mcp.save(input)).then(() => {
      // Only clear the editor once the server really is stored.
      setName('')
      setCommand('')
      setArgs('')
      setEnv('')
    })
  }

  const statusById = new Map(statuses.map((status) => [status.serverId, status]))

  return (
    <section className="flex flex-col gap-3" data-testid="settings-mcp">
      <h3 className="brutal-label flex items-center gap-2">
        <Blocks className="h-3.5 w-3.5" />
        {t('settings.mcp')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.mcpHint')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
        className="brutal-card flex flex-col gap-2 p-3"
        data-testid="mcp-add-form"
      >
        <div className="grid grid-cols-2 gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.mcpNamePlaceholder')}
            aria-label={t('settings.mcpName')}
            name="mcp-name"
            className="brutal-inset brutal-focus px-2 py-1 text-xs text-fg"
          />
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={t('settings.mcpCommandPlaceholder')}
            aria-label={t('settings.mcpCommand')}
            name="mcp-command"
            dir="ltr"
            className="brutal-inset brutal-focus brutal-data px-2 py-1 text-xs"
          />
        </div>
        <input
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          placeholder={t('settings.mcpArgsPlaceholder')}
          aria-label={t('settings.mcpArgs')}
          name="mcp-args"
          dir="ltr"
          className="brutal-inset brutal-focus brutal-data px-2 py-1 text-xs"
        />
        <p className="text-3xs text-fg-subtle">{t('settings.mcpArgsHint')}</p>
        <textarea
          value={env}
          onChange={(event) => setEnv(event.target.value)}
          placeholder={t('settings.mcpEnvHint')}
          aria-label={t('settings.mcpEnv')}
          name="mcp-env"
          rows={2}
          dir="ltr"
          className="brutal-inset brutal-focus brutal-data px-2 py-1 text-xs"
        />
        {formError !== null ? (
          <p className="text-2xs text-danger" data-testid="mcp-form-error">
            {formError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="brutal-btn brutal-primary flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('settings.mcpAdd')}
          </button>
        </div>
      </form>

      {error !== null ? (
        <p className="text-2xs text-danger" data-testid="mcp-error">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-2xs text-fg-subtle">{t('settings.mcpLoading')}</p>
      ) : servers.length === 0 ? (
        <p className="text-2xs text-fg-subtle" data-testid="mcp-empty">
          {t('settings.mcpEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server) => {
            const status = statusById.get(server.id)
            const state = status?.state ?? 'disconnected'
            const toolCount = server.toolCount ?? status?.toolCount
            return (
              <li
                key={server.id}
                data-testid="mcp-server-row"
                data-server-id={server.id}
                className="brutal-card flex flex-col gap-1.5 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{server.name}</p>
                    {/* The launch line is data, so it reads left-to-right even in an RTL locale. */}
                    <p className="brutal-data mt-0.5 truncate text-2xs text-fg-muted" dir="ltr">
                      {server.launch}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="brutal-chip" data-testid="mcp-server-enabled">
                      {t(server.enabled ? 'settings.mcpEnabled' : 'settings.mcpDisabled')}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void apply(() => window.api.mcp.setEnabled(server.id, !server.enabled))
                      }
                      aria-label={`${
                        server.enabled ? t('settings.mcpDisable') : t('settings.mcpEnable')
                      } ${server.name}`}
                      className="brutal-btn px-2 py-1 text-2xs"
                    >
                      {server.enabled ? t('settings.mcpDisable') : t('settings.mcpEnable')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void apply(() => window.api.mcp.remove(server.id))}
                      title={t('settings.mcpRemove')}
                      aria-label={`${t('settings.mcpRemove')} ${server.name}`}
                      className="brutal-btn p-1 text-fg-muted"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
                  <span className="brutal-chip" data-testid="mcp-server-state" data-state={state}>
                    {t(`settings.mcpState_${state}`)}
                  </span>
                  {server.error === undefined && toolCount !== undefined ? (
                    <span data-testid="mcp-server-tools">
                      {t('settings.mcpTools')}: {toolCount}
                    </span>
                  ) : null}
                  {server.error !== undefined ? (
                    <span className="text-danger" data-testid="mcp-server-error">
                      {server.error}
                    </span>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <div
        className="rounded-shape border-2 border-border-strong bg-bg-secondary p-3"
        data-testid="mcp-last-status"
      >
        <h4 className="brutal-label">{t('settings.mcpStatusTitle')}</h4>
        {statuses.length === 0 ? (
          <p className="mt-1 text-2xs text-fg-subtle">{t('settings.mcpStatusEmpty')}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {statuses.map((status) => (
              <li
                key={status.serverId}
                className="flex items-center justify-between gap-2 text-2xs"
                data-testid="mcp-status-row"
              >
                <span className="min-w-0 truncate text-fg">
                  {servers.find((server) => server.id === status.serverId)?.name ?? status.serverId}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="brutal-chip" data-state={status.state}>
                    {t(`settings.mcpState_${status.state}`)}
                  </span>
                  <span className="brutal-data text-fg-muted" dir="ltr">
                    {status.toolCount}
                  </span>
                  {status.error !== undefined ? (
                    <span className="max-w-40 truncate text-danger" title={status.error}>
                      {status.error}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/**
 * `KEY=value`, one per line. A line without `=` (or with an empty key) is ignored rather than
 * guessed at: inventing a variable from a malformed line would hand a server an environment
 * nobody wrote. The value is trimmed because the line already is.
 */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (key === '') continue
    env[key] = line.slice(separator + 1).trim()
  }
  return env
}

/** Arguments are whitespace-separated (the hint says so); there is no quoting to get wrong. */
export function splitArgs(text: string): string[] {
  const trimmed = text.trim()
  return trimmed === '' ? [] : trimmed.split(/\s+/)
}
