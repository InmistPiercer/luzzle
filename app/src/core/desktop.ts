export interface DesktopFile {
  name: string
  bytes: Uint8Array
}

export interface DesktopBridge {
  isDesktop: true
  platform: string
  getSecret: () => Promise<string>
  setSecret: (val: string) => Promise<boolean>
  writeAutoBackup: (json: string, day: string) => Promise<boolean>
  openBackupsFolder: () => Promise<boolean>
  clearAutoBackups: () => Promise<boolean>
  onMenuAction: (cb: (action: string, payload?: unknown) => void) => () => void
}

declare global {
  interface Window {
    luzzleDesktop?: DesktopBridge
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' && window.luzzleDesktop ? window.luzzleDesktop : null
