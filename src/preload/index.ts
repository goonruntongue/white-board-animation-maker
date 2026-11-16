import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  isDesktop: true as const,
  openImage: (): Promise<{ name: string; dataUrl: string } | null> => ipcRenderer.invoke('dialog:openImage'),
  openProject: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('dialog:openProject'),
  saveText: (args: { text: string; defaultName: string; path?: string; filters: FileFilter[] }): Promise<string | null> =>
    ipcRenderer.invoke('file:saveText', args),
  saveBinary: (args: { data: ArrayBuffer; defaultName: string; filters: FileFilter[] }): Promise<string | null> =>
    ipcRenderer.invoke('file:saveBinary', args),
  showItemInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
  setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),
  onMenu: (cb: (cmd: string, payload?: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, cmd: string, payload?: unknown): void => cb(cmd, payload)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

export type DesktopApi = typeof api

contextBridge.exposeInMainWorld('desktop', api)
