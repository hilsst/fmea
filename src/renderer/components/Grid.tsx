import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cellText, COLUMNS, type Col } from '../../shared/columns';
import { blankRow, nextId } from '../../shared/model';
import { riskLevelOf } from '../../shared/risk'; // v4-risk
import { changesSinceApproval, moveRows, moveRowsTo, TABLE_APPROVE_LABEL } from '../../shared/rowOrder';
import type { AnyRow, TableKey } from '../../shared/types';
import { useStore } from '../store';
import { badgeClass, MultiCell, RefCell, ScoreCell, SelectCell, TextCell } from './Cells';

const PAGE = 150;

interface GridProps {
  table: TableKey;
  toolbar?: ReactNode;
  /** Yeni satıra varsayılan alanlar */
  defaults?: Partial<AnyRow>;
  filter?: (r: AnyRow) => boolean;
  emptyHint?: ReactNode;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  /** v4-kc: silme engeli; mesaj döndürürse satırlar silinmez. */
  canDelete?: (ids: string[]) => string | null;
  /** Araç çubuğunun üstünde gösterilen başlık (örn. F33.03 / F05.04 form başlığı). */
  header?: ReactNode;
}

export function Grid({ table, header, toolbar, defaults, filter, emptyHint, selected: selProp, onSelect, canDelete }: GridProps) {
  const { project, edit, toast, confirm, mutate } = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [selLocal, setSelLocal] = useState<string[]>([]);
  const selected = selProp ?? selLocal;
  const setSelected = onSelect ?? setSelLocal;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Artımlı çizim: büyük tablolarda ilk PAGE satır çizilir, kaydırdıkça devamı eklenir (§63)
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [table, q, sort]);

  const std = project.settings.scoringStandard ?? 'AIAG-VDA'; // v4-kc: kolonun puanlama standardı
  const cols = COLUMNS[table].filter((c) => (all || !c.secondary) && (!c.mode || c.mode === std));
  const rows = project[table] as AnyRow[];
  // Form bölümleri: art arda aynı gruptaki kolonlar tek başlık bandında birleşir.
  const bands = useMemo(() => {
    if (!cols.some((c) => c.group)) return [];
    const out: { group: string; span: number }[] = [];
    for (const c of cols) {
      const g = c.group ?? '';
      const last = out[out.length - 1];
      if (last && last.group === g) last.span++;
      else out.push({ group: g, span: 1 });
    }
    return out;
  }, [cols]);

  const visible = useMemo(() => {
    let out = filter ? rows.filter(filter) : rows;
    if (q.trim()) {
      const n = q.toLocaleLowerCase('tr');
      out = out.filter((r) => r.id.toLowerCase().includes(n) || COLUMNS[table].some((c) => cellText(c, r, project).toLocaleLowerCase('tr').includes(n)));
    }
    if (sort) {
      const col = COLUMNS[table].find((c) => c.key === sort.key)!;
      out = [...out].sort((a, b) => {
        const av = cellText(col, a, project);
        const bv = cellText(col, b, project);
        const an = Number(av);
        const bn = Number(bv);
        if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sort.dir;
        return av.localeCompare(bv, 'tr') * sort.dir;
      });
    }
    return out;
  }, [rows, filter, q, sort, project, table]);

  const addRow = async () => {
    const id = nextId(project, table);
    await edit({ kind: 'add', table, row: { ...blankRow(table, id), ...(defaults ?? {}), id } as AnyRow }, 'Yeni satır');
    setTimeout(() => document.querySelector(`[data-row="${id}"] .cell-input, [data-row="${id}"] .cell-select`)?.scrollIntoView({ block: 'center' }), 50);
  };

  const removeSelected = async () => {
    if (!selected.length) return;
    const blocked = canDelete?.(selected); // v4-kc
    if (blocked) return toast(blocked, 'warn');
    if (!(await confirm(`${selected.length} satır silinsin mi?`, selected.join(', '), true))) return;
    const ok = await edit(selected.map((id) => ({ kind: 'delete' as const, table, id })), `${selected.length} satır silme`);
    if (ok) {
      setSelected([]);
      toast(`${selected.length} satır silindi`);
    }
  };

  const duplicate = async () => {
    if (!selected.length) return;
    let p = project;
    const adds = selected.map((sid) => {
      const src = rows.find((r) => r.id === sid)!;
      const id = nextId(p, table);
      p = { ...p, [table]: [...(p[table] as AnyRow[]), { id } as AnyRow] };
      const copy = { ...structuredClone(src), id } as unknown as Record<string, unknown>;
      if ('actionId' in copy) copy.actionId = '';
      return { kind: 'add' as const, table, row: copy as unknown as AnyRow };
    });
    await edit(adds, 'Satır kopyalama');
  };

  // Satır sırası: dizideki sıra ekran ve çıktı sırasıdır. Kolon sıralaması açıkken taşıma kapalı.
  const reorder = (next: AnyRow[] | null, ids: string[]) => {
    if (!next) return;
    mutate((d) => {
      (d as unknown as Record<string, AnyRow[]>)[table] = next;
    }, { kind: 'Modified', table, id: ids.join(', '), field: 'sıra', comment: 'Satır sırası değişti' });
  };
  const move = (dir: -1 | 1) => reorder(moveRows(rows, visible.map((r) => r.id), selected, dir), selected);
  const dropOn = (targetId: string) => {
    if (!dragId || sort) return;
    const moving = selected.includes(dragId) ? selected : [dragId];
    reorder(moveRowsTo(rows, visible.map((r) => r.id), moving, targetId), moving);
    setDragId(null);
  };

  // Mühendis incelemesi sonrası tablo onayı; geri alınabilir.
  const approval = project.tableApprovals?.[table];
  const since = changesSinceApproval(project, table, approval);
  const toggleApproval = async (on: boolean) => {
    if (on) {
      const ai = rows.filter((r) => (r as { approval?: string }).approval === 'AI Proposed').length;
      if (ai && !(await confirm('Tablo onaylansın mı?', `${ai} satır hâlâ “AI Proposed” durumunda. Bu satırlar incelenmeden tablo onaylanacak.`))) return;
    }
    mutate((d) => {
      if (!d.tableApprovals) d.tableApprovals = {};
      if (on) d.tableApprovals[table] = { user: d.settings.userName || '(kullanıcı adı girilmemiş)', at: new Date().toISOString(), revision: d.meta.fmeaRevision };
      else delete d.tableApprovals[table];
    }, { kind: 'Approval', table, id: table, field: 'tableApproval', from: on ? '' : 'Onaylı', to: on ? 'Onaylı' : 'Onay kaldırıldı' });
    toast(on ? 'Tablo onaylandı' : 'Tablo onayı kaldırıldı', on ? 'ok' : 'warn');
  };

  const isFmea = table === 'dfmea' || table === 'pfmea';
  const shown = visible.length > limit ? visible.slice(0, limit) : visible;
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (limit < visible.length && el.scrollTop + el.clientHeight > el.scrollHeight - 600) setLimit((l) => l + PAGE);
  };

  return (
    <div className="grid-wrap">
      {header}
      <div className="grid-toolbar">
        <button className="btn primary" onClick={addRow}>
          + Satır ekle
        </button>
        <button className="btn" disabled={!selected.length} onClick={duplicate}>
          Kopyala
        </button>
        <button className="btn danger" disabled={!selected.length} onClick={removeSelected}>
          Sil{selected.length ? ` (${selected.length})` : ''}
        </button>
        <button className="btn" disabled={!selected.length || !!sort} onClick={() => move(-1)} title={sort ? 'Kolon sıralamasını kapatınca taşınabilir' : 'Seçili satırları bir yukarı taşı (satırı ID hücresinden sürükleyerek de taşıyabilirsiniz)'}>
          ▲
        </button>
        <button className="btn" disabled={!selected.length || !!sort} onClick={() => move(1)} title={sort ? 'Kolon sıralamasını kapatınca taşınabilir' : 'Seçili satırları bir aşağı taşı'}>
          ▼
        </button>
        <span className="sep" />
        {toolbar}
        <button className="btn" disabled={selected.length !== 1} onClick={() => window.dispatchEvent(new CustomEvent('why', { detail: selected[0] }))} title="Kaydın kaynağı, kanıtı, bağlantı zinciri ve değişiklik geçmişi">
          Neden burada?
        </button>
        <span className="grow" />
        <label className={`check table-approval ${approval ? (since ? 'stale' : 'on') : ''}`} title={approval ? `${approval.user} · ${new Date(approval.at).toLocaleString('tr-TR')} · Rev ${approval.revision}${since ? `\nOnaydan sonra ${since} değişiklik yapıldı – yeniden inceleyin` : ''}\nİşareti kaldırarak onayı geri alabilirsiniz.` : 'Mühendis incelemesi tamamlandığında işaretleyin; onay daha sonra kaldırılabilir.'}>
          <input type="checkbox" checked={!!approval} onChange={(e) => toggleApproval(e.target.checked)} /> {TABLE_APPROVE_LABEL[table] ?? 'Tabloyu onayla'}
          {approval && since > 0 && <span className="badge b-amber">onaydan sonra {since} değişiklik</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm kolonlar
        </label>
        <input className="search" placeholder="Bu ekranda ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted count">
          {visible.length}/{rows.length}
        </span>
      </div>
      <div className="grid-scroll" onScroll={onScroll}>
        <table className="grid">
          <thead>
            {bands.length > 0 && (
              <tr className="bands">
                <th className="sticky-col sel" />
                <th className="sticky-col id" />
                {bands.map((b, i) => (
                  <th key={i} colSpan={b.span} className={`band band-${i % 2}`} title={b.group}>
                    {b.group}
                  </th>
                ))}
              </tr>
            )}
            <tr className={bands.length ? 'under-bands' : ''}>
              <th className="sticky-col sel">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((r) => selected.includes(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? visible.map((r) => r.id) : [])}
                />
              </th>
              <th className="sticky-col id">ID</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{ minWidth: c.width, width: c.width }}
                  title={[c.formLabel ? `${c.formLabel} – ${c.label}` : '', c.help, c.derived ? `Kaynak ekran: ${c.derived}` : ''].filter(Boolean).join('\n')}
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                  className={c.derived ? 'derived' : c.type === 'computed' ? 'computed' : ''}
                >
                  {c.formCol && <span className="form-col">{c.formCol}</span>}
                  {c.formLabel ?? c.label}
                  {c.help && <span className="info">ⓘ</span>}
                  {sort?.key === c.key && <span className="sort">{sort.dir === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const risk = isFmea ? riskLevelOf(project, r as never) : '';
              return (
                <tr
                  key={r.id}
                  data-row={r.id}
                  className={`${selected.includes(r.id) ? 'selected' : ''} ${risk ? 'risk-' + risk.toLowerCase() : ''} ${r.reassess ? 'reassess' : ''} ${dragId && dragId !== r.id ? 'drop-ok' : ''}`}
                  onDragOver={(e) => dragId && !sort && e.preventDefault()}
                  onDrop={() => dropOn(r.id)}
                >
                  <td className="sticky-col sel">
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
                  </td>
                  <td
                    className="sticky-col id"
                    title={r.reassess || (sort ? undefined : 'Sürükleyerek taşıyın')}
                    draggable={!sort}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(r.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                  >
                    {r.id}
                    {r.reassess && <span className="flag" title={r.reassess}>⚠</span>}
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`t-${c.type} ${c.key === 'reassess' && r.reassess ? 'warn-cell' : ''}`}>
                      <Cell col={c} row={r} table={table} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length < visible.length && (
          <div className="more">
            {shown.length}/{visible.length} satır gösteriliyor · <button className="link" onClick={() => setLimit(visible.length)}>Tümünü göster</button>
          </div>
        )}
        {rows.length === 0 && <div className="empty">{emptyHint ?? 'Henüz kayıt yok. “+ Satır ekle” ile başlayın.'}</div>}
      </div>
    </div>
  );
}

function Cell({ col, row, table }: { col: Col; row: AnyRow; table: TableKey }) {
  const { project, edit } = useStore();
  const value = (row as unknown as Record<string, unknown>)[col.key];
  const commit = (v: unknown) => edit({ kind: 'set', table, id: row.id, field: col.key, value: v }, `${row.id} · ${col.label}`);
  const props = { col, value, readonly: col.readonly, onCommit: commit, project, table };
  switch (col.type) {
    case 'computed': {
      const text = cellText(col, row, project);
      const b = badgeClass(col.key, text);
      return <div className={`cell-ro ${col.key === 'result' ? 'multi' : 'center'}`}>{text && (b ? <span className={`badge ${b}`}>{text}</span> : text)}</div>;
    }
    case 'score':
      return <ScoreCell {...props} />;
    case 'select':
      return <SelectCell {...props} />;
    case 'ref':
      return <RefCell {...props} />;
    case 'multi':
      return <MultiCell {...props} />;
    case 'bool':
      return (
        <div className="center">
          <input type="checkbox" checked={!!value} onChange={(e) => commit(e.target.checked)} />
        </div>
      );
    case 'long':
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} multiline />;
    case 'date':
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} type="date" />;
    case 'number':
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} type="number" />;
    default:
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} />;
  }
}
