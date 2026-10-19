import { contextBridge, ipcRenderer } from 'electron';
import type { Project } from '../shared/types';

type AiResult = { ok: true; data: unknown } | { ok: false; error: string };

const api = {
  openProject: (file?: string): Promise<{ path: string; data: Project } | null> => ipcRenderer.invoke('project:open', file),
  saveProject: (args: { path?: string; data: Project; saveAs?: boolean }): Promise<string | null> => ipcRenderer.invoke('project:save', args),
  recent: (): Promise<string[]> => ipcRenderer.invoke('project:recent'),
  recovery: (): Promise<{ path?: string; data: Project; at: string } | null> => ipcRenderer.invoke('project:recovery'),
  autosave: (payload: { path?: string; data: Project }) => ipcRenderer.invoke('project:autosave', payload),
  discardRecovery: () => ipcRenderer.invoke('project:discardRecovery'),
  setDirty: (v: boolean) => ipcRenderer.send('project:dirty', v),
  quit: () => ipcRenderer.send('app:quit'),
  exportExcel: (data: Project): Promise<string | null> => ipcRenderer.invoke('excel:export', data),
  pickFile: (filters?: { name: string; extensions: string[] }[]): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('file:pick', { filters }),
  openPath: (p: string) => ipcRenderer.invoke('file:open', p),
  reveal: (p: string) => ipcRenderer.invoke('file:reveal', p),
  aiStatus: (): Promise<{ configured: boolean; fromEnv: boolean }> => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key: string) => ipcRenderer.invoke('ai:setKey', key),
  aiRequirements: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:requirements', a),
  aiDfmea: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:dfmea', a),
  aiPfmea: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:pfmea', a),
  aiReview: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:review', a),
  onMenu: (cb: (id: string) => void) => {
    const h = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('menu', h);
    return () => {
      ipcRenderer.removeListener('menu', h);
    };
  },
  onOpenFile: (cb: (p: string) => void) => {
    const h = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on('open-file', h);
    return () => {
      ipcRenderer.removeListener('open-file', h);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
