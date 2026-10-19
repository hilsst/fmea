import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { crossScreenEffects, planEdits, type Edit, type Effect, type Plan } from '../shared/engine';
import { newProject, normalizeProject } from '../shared/model';
import type { Project } from '../shared/types';
import { api } from './api';

export interface PendingChange {
  title: string;
  edits: Edit[];
  plan: Plan;
  effects: Effect[];
  resolve: (applied: boolean) => void;
}

interface Store {
  project: Project;
  filePath?: string;
  dirty: boolean;
  /** Düzenlemeleri uygular; başka ekranları etkiliyorsa önce onay penceresi gösterir. */
  edit: (edits: Edit | Edit[], title?: string) => Promise<boolean>;
  pending: PendingChange | null;
  decide: (choice: 'apply' | 'only' | 'cancel') => void;
  replace: (p: Project, path?: string, markClean?: boolean) => void;
  /** Revizyon özeti gibi yayılmayan doğrudan güncellemeler. */
  mutate: (fn: (draft: Project) => void) => void;
  setPath: (p?: string) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  toast: (msg: string, kind?: 'ok' | 'warn' | 'err') => void;
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

  const commit = useCallback((next: Project) => {
    undoStack.current.push(projectRef.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setProject(next);
    setDirty(true);
  }, []);

  const edit = useCallback(
    (e: Edit | Edit[], title = 'Değişiklik') => {
      const edits = Array.isArray(e) ? e : [e];
      const plan = planEdits(projectRef.current, edits, true);
      const effects = crossScreenEffects(plan, edits);
      if (effects.length === 0) {
        if (plan.effects.length) commit(plan.project);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => setPending({ title, edits, plan, effects, resolve }));
    },
    [commit],
  );

  const decide = useCallback(
    (choice: 'apply' | 'only' | 'cancel') => {
      if (!pending) return;
      if (choice === 'apply') commit(pending.plan.project);
      else if (choice === 'only') commit(planEdits(projectRef.current, pending.edits, false).project);
      pending.resolve(choice !== 'cancel');
      setPending(null);
      if (choice === 'apply') toast(`${pending.effects.length} bağlı kayıt güncellendi`);
      if (choice === 'cancel') toast('Değişiklik geri alındı', 'warn');
    },
    [pending, commit, toast],
  );

  const replace = useCallback((p: Project, path?: string, markClean = true) => {
    undoStack.current = [];
    redoStack.current = [];
    setProject(normalizeProject(p));
    setPath(path);
    setDirty(!markClean);
  }, []);

  const mutate = useCallback(
    (fn: (d: Project) => void) => {
      const d = structuredClone(projectRef.current);
      fn(d);
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
      toasts,
    }),
    [project, filePath, dirty, edit, pending, decide, replace, mutate, undo, redo, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
