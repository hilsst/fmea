import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { auditEntries, needsReason, withAudit, type AuditMeta } from '../shared/audit';
import { verifyBaseline } from '../shared/baseline';
import { crossScreenEffects, planEdits, type Edit, type Effect, type Plan } from '../shared/engine';
import { newProject, normalizeProject, type MigrationReport } from '../shared/model';
import type { AuditEntry, Project } from '../shared/types';
import { api } from './api';

export interface PendingChange {
  title: string;
  edits: Edit[];
  plan: Plan;
  effects: Effect[];
  /** Ayarlar › neden alanlarından biri değişiyorsa neden zorunludur (§37). */
  needReason: boolean;
  resolve: (applied: boolean) => void;
}

/** Uygulama içi onay / metin sorusu (window.confirm/prompt yerine: Windows'ta Electron sistem penceresi klavye odağını bozuyor). */
export interface AskOptions {
  title: string;
  message?: string;
  /** Verilirse metin kutusu gösterilir; değer varsayılan metindir. */
  input?: string;
  okLabel?: string;
  danger?: boolean;
}
export interface AskRequest extends AskOptions {
  resolve: (v: string | null) => void;
}

interface Store {
  project: Project;
  filePath?: string;
  dirty: boolean;
  /** Düzenlemeleri uygular; başka ekranları etkiliyorsa önce onay penceresi gösterir. */
  edit: (edits: Edit | Edit[], title?: string) => Promise<boolean>;
  pending: PendingChange | null;
  decide: (choice: 'apply' | 'only' | 'cancel', reason?: string, comment?: string) => void;
  replace: (p: Project, path?: string, markClean?: boolean) => void;
  /** Revizyon özeti gibi yayılmayan doğrudan güncellemeler; audit verilirse denetim izine yazılır. */
  mutate: (fn: (draft: Project) => void, audit?: Omit<AuditEntry, 'at' | 'user' | 'revision'>) => void;
  setPath: (p?: string) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  toast: (msg: string, kind?: 'ok' | 'warn' | 'err') => void;
  /** Tamam → metin (input yoksa ''), Vazgeç → null. */
  ask: (o: AskOptions) => Promise<string | null>;
  /** Evet/hayır sorusu. */
  confirm: (title: string, message?: string, danger?: boolean) => Promise<boolean>;
  asking: AskRequest | null;
  answer: (v: string | null) => void;
  toasts: { id: number; msg: string; kind: string }[];
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('store yok');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => newProject());
  const [filePath, setPath] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [asking, setAsking] = useState<AskRequest | null>(null);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const [, force] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  const toast = useCallback((msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 8000 : 4000);
  }, []);

  const commit = useCallback((next: Project, effects?: Effect[], meta?: Omit<AuditMeta, 'user'>) => {
    if (effects?.length) next = withAudit(next, auditEntries(next, effects, { ...meta, user: next.settings.userName }));
    undoStack.current.push(projectRef.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    // Ardışık edit/mutate çağrıları aynı turda en güncel projeyi görsün.
    projectRef.current = next;
    setProject(next);
    setDirty(true);
  }, []);

  const edit = useCallback(
    (e: Edit | Edit[], title = 'Değişiklik') => {
      const edits = Array.isArray(e) ? e : [e];
      const plan = planEdits(projectRef.current, edits, true);
      const effects = crossScreenEffects(plan, edits);
      const needReason = needsReason(projectRef.current, plan.effects);
      if (effects.length === 0 && !needReason) {
        if (plan.effects.length) commit(plan.project, plan.effects);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => setPending({ title, edits, plan, effects, needReason, resolve }));
    },
    [commit],
  );

  const decide = useCallback(
    (choice: 'apply' | 'only' | 'cancel', reason?: string, comment?: string) => {
      if (!pending) return;
      if (choice === 'apply') commit(pending.plan.project, pending.plan.effects, { reason, comment });
      else if (choice === 'only') {
        const only = planEdits(projectRef.current, pending.edits, false);
        commit(only.project, only.effects, { reason, comment });
      }
      pending.resolve(choice !== 'cancel');
      setPending(null);
      if (choice === 'apply' && pending.effects.length) toast(`${pending.effects.length} bağlı kayıt güncellendi`);
      if (choice === 'cancel') toast('Değişiklik geri alındı', 'warn');
    },
    [pending, commit, toast],
  );

  const replace = useCallback((p: Project, path?: string, markClean = true) => {
    undoStack.current = [];
    redoStack.current = [];
    const rep = {} as MigrationReport;
    const n = normalizeProject(p, rep);
    projectRef.current = n;
    setProject(n);
    setPath(path);
    setDirty(!markClean || rep.from < rep.to);
    for (const note of rep.notes ?? []) toast(note, 'warn');
    const broken = n.baselines.filter((b) => !verifyBaseline(b)).map((b) => b.id);
    if (broken.length) toast(`UYARI: ${broken.join(', ')} baseline mührü bozuk – dosya dışarıdan değiştirilmiş olabilir.`, 'err');
  }, [toast]);

  const mutate = useCallback(
    (fn: (d: Project) => void, audit?: Omit<AuditEntry, 'at' | 'user' | 'revision'>) => {
      const d = structuredClone(projectRef.current);
      fn(d);
      if (audit) d.auditLog.push({ ...audit, at: new Date().toISOString(), user: d.settings.userName || '(kullanıcı adı girilmemiş)', revision: d.meta.fmeaRevision });
      commit(d);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(projectRef.current);
    setProject(prev);
    setDirty(true);
    force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    const nxt = redoStack.current.pop();
    if (!nxt) return;
    undoStack.current.push(projectRef.current);
    setProject(nxt);
    setDirty(true);
    force((x) => x + 1);
  }, []);

  const ask = useCallback((o: AskOptions) => new Promise<string | null>((resolve) => setAsking({ ...o, resolve })), []);
  const confirm = useCallback(async (title: string, message?: string, danger?: boolean) => (await ask({ title, message, danger })) !== null, [ask]);
  const answer = useCallback(
    (v: string | null) => {
      asking?.resolve(v);
      setAsking(null);
    },
    [asking],
  );

  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);

  // Çökme/elektrik kesintisine karşı kurtarma kopyası
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => api.autosave({ path: filePath, data: project }), 2500);
    return () => clearTimeout(t);
  }, [project, dirty, filePath]);

  const value = useMemo<Store>(
    () => ({
      project,
      filePath,
      dirty,
      edit,
      pending,
      decide,
      replace,
      mutate,
      setPath,
      markSaved: () => setDirty(false),
      undo,
      redo,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      toast,
      ask,
      confirm,
      asking,
      answer,
      toasts,
    }),
    [project, filePath, dirty, edit, pending, decide, replace, mutate, undo, redo, toast, ask, confirm, asking, answer, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
