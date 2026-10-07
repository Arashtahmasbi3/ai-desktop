import type { RemoteStatus } from '@shared/ui'

export interface RemoteServerOptions {
  host?: string
  port: number
  /** Shared secret clients must present. Generated when omitted. */
  token?: string
  /** Handles an authenticated request and returns a JSON-serializable result. */
  onRequest: (method: string, params: unknown) => Promise<unknown> | unknown
  onStatus?: (status: RemoteStatus) => void
}

export interface RemoteRequest {
  id?: string | number
  method: string
  params?: unknown
}

export interface RemoteResponse {
  id?: string | number
  result?: unknown
  error?: string
}

/** Processes a remote request with the token already validated. */
export async function handleRequest(
  request: RemoteRequest,
  onRequest: RemoteServerOptions['onRequest']
): Promise<RemoteResponse> {
  try {
    const result = await onRequest(request.method, request.params)
    return { id: request.id, result }
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
}
