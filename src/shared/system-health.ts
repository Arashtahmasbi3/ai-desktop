/** Remote system health (v2.3.3, C.1). Shared by main, preload and renderer. */

export interface ToolHealth {
  installed: boolean
  version?: string
}

export interface DiskHealth {
  total: string
  used: string
  free: string
  percent: number
}

export interface MemoryHealth {
  total: string
  used: string
  free: string
}

export interface OsHealth {
  name: string
  version: string
}

export interface SystemHealth {
  node: ToolHealth
  npm: ToolHealth
  git: ToolHealth
  docker: ToolHealth
  pm2: ToolHealth
  disk: DiskHealth
  memory: MemoryHealth
  os: OsHealth
}

/** A suggested fix surfaced in the diagnostics panel. */
export interface HealthRecommendation {
  id: string
  message: string
  /** Installable tool id, when the recommendation maps to an install recipe. */
  installTool?: string
}
