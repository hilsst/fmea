import { contextBridge, ipcRenderer } from 'electron';
import type { AiResult } from '../shared/aischema';
import type { ExtractedDoc } from '../shared/docmodel';
import type { SheetGrid } from '../shared/importmap';
import type { Project } from '../shared/types';
import type { UpdateStatus } from './updater';

// Arayüzün erişebildiği tek yüzey (beyaz liste). Node API'leri arayüze açılmaz (§62).
type Ok<T> = { ok: true; data: T } | { ok: false; error: string };

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
  exportExcelV2: (data: Project): Promise<string | null> => ipcRenderer.invoke('excel:exportV2', data),
  exportScmh: (data: Project): Promise<{ ok: true; files: string[]; dir: string } | { ok: false; error: string }> => ipcRenderer.invoke('scmh:export', data),
  scmhGetDir: (): Promise<{ dir: string; missing: string[] }> => ipcRenderer.invoke('scmh:getDir'),
  scmhPickDir: (): Promise<{ dir: string; missing: string[] } | null> => ipcRenderer.invoke('scmh:pickDir'),
  readGrid: (): Promise<{ name: string; sheets: SheetGrid[] } | null> => ipcRenderer.invoke('excel:readGrid'),
  exportReport: (a: { html: string; format: 'pdf' | 'html'; name: string }): Promise<string | null> => ipcRenderer.invoke('report:export', a),
  saveTemplate: (t: unknown): Promise<string | null> => ipcRenderer.invoke('template:save', t),
  openTemplate: (): Promise<unknown> => ipcRenderer.invoke('template:open'),
  openReference: (): Promise<{ name: string; data: Project } | null> => ipcRenderer.invoke('reference:open'),
  pickFile: (filters?: { name: string; extensions: string[] }[]): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('file:pick', { filters }),
  openPath: (p: string) => ipcRenderer.invoke('file:open', p),
  reveal: (p: string) => ipcRenderer.invoke('file:reveal', p),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  extractDoc: (p: string): Promise<{ ok: true; doc: ExtractedDoc } | { ok: false; error: string }> => ipcRenderer.invoke('doc:extract', p),
  aiStatus: (): Promise<{
    configured: boolean; fromEnv: boolean; envVar: string; secureStorage: boolean; sessionOnly: boolean; provider: string; model: string;
    providers: readonly { id: string; label: string; supported: boolean }[]; anthropicModels?: readonly { id: string; label: string }[]; online: boolean;
  }> => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key: string): Promise<{ stored: 'secure' | 'session' | 'cleared' }> => ipcRenderer.invoke('ai:setKey', key),
  aiSetProvider: (id: string): Promise<string> => ipcRenderer.invoke('ai:setProvider', id),
  aiSetModel: (model: string): Promise<string> => ipcRenderer.invoke('ai:setModel', model),
  aiClearCache: () => ipcRenderer.invoke('ai:clearCache'),
  examplesInfo: (): Promise<{ count: number }> => ipcRenderer.invoke('examples:info'),
  examplesClear: () => ipcRenderer.invoke('examples:clear'),
  aiRequirements: (a: unknown): Promise<AiResult & { note?: string }> => ipcRenderer.invoke('ai:requirements', a),
  aiDfmea: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:dfmea', a),
  aiPfmea: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:pfmea', a),
  aiReview: (a: unknown): Promise<AiResult> => ipcRenderer.invoke('ai:review', a),
  ifsGet: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('ifs:get'),
  ifsSet: (s: Record<string, unknown>): Promise<Record<string, unknown>> => ipcRenderer.invoke('ifs:set', s),
  ifsTest: (): Promise<Ok<{ ok: boolean; message: string }>> => ipcRenderer.invoke('ifs:test', ''),
  ifsParts: (q: string): Promise<Ok<{ partNo: string; description: string; revision: string }[]>> => ipcRenderer.invoke('ifs:parts', q),
  ifsNcrs: (partNo: string): Promise<Ok<{ ncrNo: string; partNo: string; date: string; description: string; rootCause: string; action: string }[]>> => ipcRenderer.invoke('ifs:ncrs', partNo),
  ifsRouting: (partNo: string): Promise<Ok<{ partNo: string; opNo: string; name: string; workCenter: string }[]>> => ipcRenderer.invoke('ifs:routing', partNo),
  onMenu: (cb: (id: string) => void) => {
    const h = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('menu', h);
    return () => {
      ipcRenderer.removeListener('menu', h);
    };
  },
  checkUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (cb: (s: UpdateStatus) => void) => {
    const h = (_e: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on('update', h);
    return () => {
      ipcRenderer.removeListener('update', h);
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
