export interface Api {
  app: {
    ping(): Promise<string>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
