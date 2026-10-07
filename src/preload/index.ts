import { contextBridge, ipcRenderer } from 'electron'

export const api = {
  app: {
    ping: (): Promise<string> => ipcRenderer.invoke('app:ping')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as unknown as { api: typeof api }).api = api
}
