/**
 * R6: a sentence about a server names it, never its UUID.
 *
 * The stop card printed
 *
 *   `Diagnostics always run against the server selected in the chat header
 *    (34c80099-2868-40a1-bef4-9b23d865db0b), not e000539d-4199-46eb-a350-9406a210b514.`
 *
 * two raw ids in a sentence a user reads. The id is still the routing key: it stays in the
 * audit log, on the tool result (`serverId`) and behind a disclosure. A *sentence* must use
 * the name the user gave the machine.
 *
 * The lookup is injected and async because the roster lives in main's store, and every
 * helper here is defensive: a name that cannot be read is `undefined`, never the id. A
 * missing name therefore produces a neutral phrase ("the selected server"), which is still
 * honest and still free of a UUID.
 */
export type ServerNameLookup = (
  serverId: string
) => Promise<string | undefined> | string | undefined

/** The saved name for `serverId`, or `undefined`. Never falls back to the id, never throws. */
export async function serverNameFor(
  lookup: ServerNameLookup | undefined,
  serverId: string
): Promise<string | undefined> {
  if (lookup === undefined || serverId.trim() === '') return undefined
  try {
    const name = await lookup(serverId)
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined
  } catch {
    // A roster read that fails must not turn an error message into a second error.
    return undefined
  }
}

/** The name for `serverId`, or `fallback` when the roster has none. Never the id. */
export async function serverLabel(
  lookup: ServerNameLookup | undefined,
  serverId: string,
  fallback: string
): Promise<string> {
  return (await serverNameFor(lookup, serverId)) ?? fallback
}

/**
 * The connected servers as names (`spmotor, backup-host`), or `none`.
 *
 * A server the roster cannot name is "an unnamed server" rather than its id: the list is
 * read by a human deciding what to do next, and a UUID is not an answer to that.
 */
export async function connectedServerNames(
  lookup: ServerNameLookup | undefined,
  serverIds: readonly string[],
  none = 'none'
): Promise<string> {
  if (serverIds.length === 0) return none
  const names = await Promise.all(
    serverIds.map(async (serverId) => (await serverNameFor(lookup, serverId)) ?? 'an unnamed server')
  )
  return names.join(', ')
}

/** `Server spmotor is not connected.` — or a neutral sentence when the name is unknown. */
export async function notConnectedMessage(
  lookup: ServerNameLookup | undefined,
  serverId: string,
  fallback = 'The selected server'
): Promise<string> {
  const name = await serverNameFor(lookup, serverId)
  return name === undefined
    ? `${fallback} is not connected.`
    : `Server ${name} is not connected.`
}
