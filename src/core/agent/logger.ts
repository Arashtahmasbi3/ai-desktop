import type { AgentLogEntry, AgentLogLevel, AgentLogger } from '@shared/agent'
import { redact, redactValue } from './redact'

const LEVEL_ORDER: Record<AgentLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

export type LogSink = (line: string, entry: AgentLogEntry) => void

/**
 * Emits one JSON object per log record (JSON Lines). This keeps logs greppable
 * and machine-parseable while staying readable for humans.
 */
export class JsonLogger implements AgentLogger {
  constructor(
    private readonly sink: LogSink = (line) => console.log(line),
    private readonly minLevel: AgentLogLevel = 'debug'
  ) {}

  log(entry: AgentLogEntry): void {
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[this.minLevel]) return
    const safe = redactValue(entry)
    this.sink(redact(JSON.stringify(safe)), safe)
  }
}

/** In-memory logger for tests and diagnostics. */
export class MemoryLogger implements AgentLogger {
  readonly entries: AgentLogEntry[] = []

  log(entry: AgentLogEntry): void {
    this.entries.push(redactValue(entry))
  }

  /** All events with the given name. */
  find(event: string): AgentLogEntry[] {
    return this.entries.filter((entry) => entry.event === event)
  }

  /** First entry with the given event name, if any. */
  first(event: string): AgentLogEntry | undefined {
    return this.entries.find((entry) => entry.event === event)
  }

  count(event: string): number {
    return this.find(event).length
  }

  clear(): void {
    this.entries.length = 0
  }
}

/** Logger that discards everything. */
export const silentLogger: AgentLogger = { log: () => undefined }

export function createJsonLogger(sink?: LogSink, minLevel?: AgentLogLevel): JsonLogger {
  return new JsonLogger(sink, minLevel)
}

/** Build an entry, filling in the timestamp. */
export function makeLogEntry(
  level: AgentLogLevel,
  event: string,
  runId: string,
  extra: Omit<Partial<AgentLogEntry>, 'ts' | 'level' | 'event' | 'runId'> = {}
): AgentLogEntry {
  return { ts: new Date().toISOString(), level, event, runId, ...extra }
}
