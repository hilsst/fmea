import { useEffect, useMemo, useRef, useState } from 'react';
import { rowLabel, type Col } from '../../shared/columns';
import type { Project, ScoringEntry, TableKey } from '../../shared/types';

interface CellProps {
  col: Col;
  value: unknown;
  readonly?: boolean;
  onCommit: (v: unknown) => Promise<boolean>;
  project: Project;
  table: TableKey;
}

export function TextCell({ value, readonly, onCommit, multiline, type = 'text' }: { value: unknown; readonly?: boolean; onCommit: (v: unknown) => Promise<boolean>; multiline?: boolean; type?: string }) {
  const initial = value == null ? '' : String(value);
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(initial), [initial]);
  useEffect(() => {
    if (multiline && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 160)}px`;
    }
  }, [v, multiline]);
  const commit = () => {
    if (v === initial) return;
    const out = type === 'number' ? (v.trim() === '' ? null : Number(v.replace(',', '.'))) : v;
    if (type === 'number' && out != null && !Number.isFinite(out)) {
      setV(initial);
      return;
    }
    onCommit(out).then((ok) => {
      if (!ok) setV(initial);
    });
  };
  if (readonly) return <div className={`cell-ro ${multiline ? 'multi' : ''}`}>{initial}</div>;
  if (multiline)
    return (
      <textarea
        ref={ref}
        className="cell-input"
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setV(initial);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
        }}
      />
    );
  return (
    <input
      className="cell-input"
      type={type === 'date' ? 'date' : 'text'}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(initial);
      }}
    />
  );
}

function scoreList(project: Project, key: string): ScoringEntry[] {
  if (key === 's' || key === 'newS' || key === 'predS') return project.scoring.severity;
  if (key === 'o' || key === 'newO' || key === 'predO') return project.scoring.occurrence;
  return project.scoring.detection;
}

export function ScoreCell({ col, value, readonly, onCommit, project, table }: CellProps) {
  const list = scoreList(project, col.key);
  const pf = table === 'pfmea';
  const v = typeof value === 'number' ? value : null;
  const entry = list.find((e) => e.rank === v);
  const cls = v == null ? '' : col.key.toLowerCase().endsWith('s') && v >= project.settings.highSeverityThreshold ? 'score-high' : '';
  if (readonly) return <div className={`cell-ro center ${cls}`}>{v ?? ''}</div>;
  return (
    <select
      className={`cell-select score ${cls}`}
      value={v ?? ''}
      title={entry ? `${entry.rank}: ${pf ? entry.pf : entry.df}` : col.help}
      onChange={(e) => onCommit(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">–</option>
      {[...list].sort((a, b) => b.rank - a.rank).map((e) => (
        <option key={e.rank} value={e.rank} title={pf ? e.pf : e.df}>
          {e.rank} – {(pf ? e.pf : e.df).slice(0, 70)}
        </option>
      ))}
    </select>
  );
}

export function SelectCell({ col, value, readonly, onCommit }: CellProps) {
  const v = value == null ? '' : String(value);
  if (readonly) return <div className="cell-ro">{v}</div>;
  if (col.free) {
    const id = `dl-${col.key}`;
    return (
      <>
        <TextCell value={v} onCommit={onCommit} />
        <datalist id={id}>{col.options?.map((o) => <option key={o} value={o} />)}</datalist>
        <FreeListBinder listId={id} />
      </>
    );
  }
  const opts = col.options ?? [];
  return (
    <select className={`cell-select ${badgeClass(col.key, v)}`} value={v} onChange={(e) => onCommit(e.target.value)}>
      <option value=""></option>
      {!opts.includes(v) && v && <option value={v}>{v}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Bir önceki kardeş input'a datalist bağlar. */
function FreeListBinder({ listId }: { listId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const input = ref.current?.parentElement?.querySelector('input');
    input?.setAttribute('list', listId);
  }, [listId]);
  return <span ref={ref} hidden />;
}

export function refOptions(project: Project, ref: TableKey | TableKey[] | undefined): { id: string; label: string }[] {
  const tables = ref ? (Array.isArray(ref) ? ref : [ref]) : [];
  return tables.flatMap((t) => (project[t] as { id: string }[]).map((r) => ({ id: r.id, label: rowLabel(project, r.id) })));
}

/** Tek seçimli bağlantı hücresi. Seçenek listesi yalnızca açıldığında hesaplanır (500+ satırda performans). */
export function RefCell({ col, value, readonly, onCommit, project }: CellProps) {
  const v = value == null ? '' : String(value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const opts = useMemo(() => (!open ? [] : col.options ? col.options.map((o) => ({ id: o, label: o })) : refOptions(project, col.ref)), [open, project, col.ref, col.options]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  if (readonly) return <div className="cell-ro">{v}</div>;
  const pick = (id: string) => {
    setOpen(false);
    if (id !== v) onCommit(id);
  };
  return (
    <div className="multi-cell" ref={box}>
      <button className="chips ref" onClick={() => setOpen(!open)} title={v ? rowLabel(project, v) : ''}>
        {v ? <span className="chip">{v}</span> : <span className="muted">seç…</span>}
      </button>
      {open && (
        <div className="popover">
          <input autoFocus className="pop-search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
          <div className="pop-list">
            <button className="pop-item btnlike" onClick={() => pick('')}><span className="muted">(boş)</span></button>
            {v && !opts.some((o) => o.id === v) && <div className="pop-item muted">{v} (bulunamadı)</div>}
            {opts
              .filter((o) => o.label.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
              .map((o) => (
                <button key={o.id} className={`pop-item btnlike ${o.id === v ? 'on' : ''}`} onClick={() => pick(o.id)}>
                  <span>{o.label}</span>
                </button>
              ))}
            {opts.length === 0 && <div className="muted pad">Bağlanacak kayıt yok</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function MultiCell({ col, value, readonly, onCommit, project }: CellProps) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(ids);
  const [q, setQ] = useState('');
  const opts = useMemo(() => (!open ? [] : col.options ? col.options.map((o) => ({ id: o, label: o })) : refOptions(project, col.ref)), [open, project, col.ref, col.options]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(ids), [ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  });
  const close = () => {
    setOpen(false);
    if (sel.join('|') !== ids.join('|')) onCommit(sel).then((ok) => !ok && setSel(ids));
  };
  return (
    <div className="multi-cell" ref={box}>
      <button className="chips" disabled={readonly} onClick={() => (open ? close() : setOpen(true))} title={ids.length ? ids.map((i) => (col.options ? i : rowLabel(project, i))).join('\n') : ''}>
        {ids.length ? ids.map((i) => <span key={i} className="chip">{i}</span>) : <span className="muted">seç…</span>}
      </button>
      {open && (
        <div className="popover">
          <input autoFocus className="pop-search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pop-list">
            {opts
              .filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
              .map((o) => (
                <label key={o.id} className="pop-item">
                  <input type="checkbox" checked={sel.includes(o.id)} onChange={(e) => setSel(e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id))} />
                  <span>{o.label}</span>
                </label>
              ))}
            {opts.length === 0 && <div className="muted pad">Bağlanacak kayıt yok</div>}
          </div>
          <div className="pop-foot">
            <button className="btn small" onClick={close}>
              Tamam
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function badgeClass(key: string, text: string): string {
  if (!text) return '';
  if (key === 'ap' || key === 'newAp') return text === 'H' ? 'b-red' : text === 'M' ? 'b-amber' : 'b-green';
  if (key === 'risk') return text === 'CRITICAL' ? 'b-red strong' : text === 'HIGH' ? 'b-red' : text === 'MEDIUM' ? 'b-amber' : 'b-green';
  if (key === 'kcFlag') return 'b-purple';
  if (key === 'approval' || key === 'status') {
    if (text === 'Approved' || text === 'Completed' || text === 'Closed' || text === 'Resolved' || text === 'Acceptable') return 'b-green';
    if (text === 'Rejected' || text === 'Cancelled' || text === 'Not acceptable') return 'b-gray';
    if (text === 'AI Proposed') return 'b-amber';
    if (text === 'Open' || text === 'In Progress' || text === 'Under Review' || text === 'Waiting Customer') return 'b-blue';
  }
  if (key === 'actionStatus') return text === 'Completed' ? 'b-green' : text === 'Cancelled' ? 'b-gray' : 'b-blue';
  if (key === 'priority') return text === 'Critical' ? 'b-red' : text === 'Important' ? 'b-amber' : 'b-gray';
  if (key === 'overdue' || key === 'hist') return 'b-amber';
  if (key === 'kcClass') return 'b-purple';
  return '';
}
