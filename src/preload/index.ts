import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export interface McpInfo {
  enabled: boolean
  running: boolean
  url: string
  error?: string
  exportDir: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  isDesktop: true as const,
  openImage: (opts?: { allowSvg?: boolean }): Promise<{ name: string; dataUrl: string } | null> =>
    ipcRenderer.invoke('dialog:openImage', opts),
  openProject: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('dialog:openProject'),
  saveText: (args: { text: string; defaultName: string; path?: string; filters: FileFilter[] }): Promise<string | null> =>
    ipcRenderer.invoke('file:saveText', args),
  saveBinary: (args: { data: ArrayBuffer; defaultName: string; filters: FileFilter[] }): Promise<string | null> =>
    ipcRenderer.invoke('file:saveBinary', args),
  showItemInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
  setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),
  setTheme: (pref: 'light' | 'dark' | 'system'): void => ipcRenderer.send('window:setTheme', pref),
  /** AI 連携（MCP）：エンドポイントの状態・オン/オフ・合言葉の作り直し、AI からの道具の呼び出し */
  mcp: {
    info: (): Promise<McpInfo> => ipcRenderer.invoke('mcp:info'),
    setEnabled: (on: boolean): Promise<McpInfo> => ipcRenderer.invoke('mcp:setEnabled', on),
    regenerate: (): Promise<McpInfo> => ipcRenderer.invoke('mcp:regenerate'),
    onCall: (cb: (call: { id: string; name: string; args: Record<string, unknown> }) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, call: { id: string; name: string; args: Record<string, unknown> }): void => cb(call)
      ipcRenderer.on('mcp:call', listener)
      return () => ipcRenderer.removeListener('mcp:call', listener)
    },
    reply: (id: string, outcome: unknown): void => ipcRenderer.send('mcp:result', { id, outcome })
  },
  onMenu: (cb: (cmd: string, payload?: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, cmd: string, payload?: unknown): void => cb(cmd, payload)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

export type DesktopApi = typeof api

contextBridge.exposeInMainWorld('desktop', api)
