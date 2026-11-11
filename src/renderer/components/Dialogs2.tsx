// 2.0 pencereleri: "Bu kayıt neden burada?" çekmecesi (§48), Excel FMEA içe aktarma (§44) ve benzer FMEA (§50).
import { useEffect, useMemo, useState } from 'react';
import { rowLabel } from '../../shared/columns';
import { originOf } from '../../shared/impact';
import { COMPUTED, IGNORE, IMPORT_TABLES, IMPORT_TARGETS, applyImport, cellAddress, detectHeaderRow, suggestMapping, type ImportTable, type SheetGrid } from '../../shared/importmap';
import { TABLE_LABEL, blankRow, nextId, normalizeProject, tableOfId } from '../../shared/model';
import { screenOfTable } from '../../shared/nav';
import type { AnyRow, DfmeaRow, PfmeaRow, Project } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { Modal } from './Modal';

export const goto = (screen: string, sub?: string) => window.dispatchEvent(new CustomEvent('goto', { detail: { screen, sub } }));

// ───────────────────────── Neden burada? ─────────────────────────

export function WhyDrawer() {
  const { project: p } = useStore();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener('why', h);
    return () => window.removeEventListener('why', h);
  }, []);
  if (!id) return null;
  const t = tableOfId(id);
  const row = t ? (p[t] as AnyRow[]).find((r) => r.id === id) : undefined;
  const chain = originOf(p, id);
  const ev = p.evidence.filter((e) => e.linkedIds.includes(id) || (row?.evidenceIds ?? []).includes(e.id));
  const runs = p.aiRuns.filter((r) => ev.some((e) => e.aiRunId === r.id));
  const audit = p.auditLog.filter((a) => a.id === id).slice(-12).reverse();
  const loc = t ? screenOfTable(t) : null;
  const src = row as (AnyRow & { source?: string; dataStatus?: string; approval?: string }) | undefined;
  return (
    <div className="drawer-back" onClick={() => setId(null)}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="icon">?</div>
          <div>
            <h2>Bu kayıt neden burada?</h2>
            <p>{rowLabel(p, id)}</p>
          </div>
          <button className="x" onClick={() => setId(null)} aria-label="Kapat">×</button>
        </div>
        <div className="modal-body">
          {!row && <p className="muted">Kayıt bulunamadı (silinmiş olabilir).</p>}
          {row && (
            <>
              <p className="small">
                <b>Kaynak türü:</b> {originText(row.origin)}
                {src?.source && <><br /><b>Kaynak:</b> {src.source}</>}
                {src?.dataStatus && <><br /><b>Veri durumu:</b> {src.dataStatus}</>}
                {src?.approval && <><br /><b>Onay:</b> {src.approval}</>}
                {row.reassess && <><br /><b className="warn-text">{row.reassess}</b></>}
                {row.rejectReason && <><br /><b>Ret nedeni:</b> {row.rejectReason}</>}
              </p>
              {loc && <button className="btn small" onClick={() => { goto(loc.screen, loc.sub); setId(null); }}>Ekrana git →</button>}
              <h4>Köken zinciri</h4>
              {chain.length === 0 ? <p className="muted small">Yukarı yönde bağlı kayıt yok.</p> : (
                <ul className="plain small">
                  {chain.map((c) => (
                    <li key={c.id} style={{ paddingLeft: (c.depth - 1) * 12 }}>
                      ↑ <button className="link" onClick={() => setId(c.id)}>{rowLabel(p, c.id)}</button> <span className="muted">({c.via})</span>
                    </li>
                  ))}
                </ul>
              )}
              <h4>Kanıtlar ({ev.length})</h4>
              {ev.length === 0 ? <p className="muted small">Bağlı kanıt yok.</p> : ev.map((e) => (
                <div key={e.id} className="ev small">
                  <span className={`badge ${e.verification === 'VERIFIED' ? 'b-green' : e.verification === 'SOURCE NOT VERIFIED' ? 'b-red' : 'b-amber'}`}>{e.verification || 'doğrulanmadı'}</span>{' '}
                  <b>{e.id}</b> {e.docId} {[e.page && `s.${e.page}`, e.section, e.sheet, e.cell, e.balloon].filter(Boolean).join(' · ')}
                  <blockquote>{e.quote || '—'}</blockquote>
                  <span className="muted">{e.basis} · {e.confidence}</span>
                </div>
              ))}
              {runs.length > 0 && (
                <>
                  <h4>AI çalıştırması</h4>
                  <ul className="plain small">{runs.map((r) => <li key={r.id}>{r.id} · {r.role} · {r.model} · {new Date(r.at).toLocaleString('tr-TR')} · kabul {r.accepted} / ret {r.rejected}</li>)}</ul>
                </>
              )}
              <h4>Son değişiklikler</h4>
              {audit.length === 0 ? <p className="muted small">Denetim izinde kayıt yok.</p> : (
                <ul className="plain small">
                  {audit.map((a, i) => <li key={i}>{new Date(a.at).toLocaleString('tr-TR')} · {a.user || '—'} · {a.kind}{a.field ? ` ${a.field}` : ''}{a.reason ? ` · ${a.reason}` : ''}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function originText(o?: string) {
  return ({ manual: 'Elle girildi', ai: 'AI önerisi (mühendis kabul etti)', import: 'Excel içe aktarma', extraction: 'Doküman çıkarımı (yerel)', template: 'Şablon', similar: 'Benzer FMEA’dan kopya' } as Record<string, string>)[o ?? ''] ?? 'Belirtilmemiş (1.0 kaydı veya eski dosya)';
}

// ───────────────────────── Excel içe aktarma ─────────────────────────

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { project: p, edit, toast } = useStore();
  const [file, setFile] = useState<{ name: string; sheets: SheetGrid[] } | null>(null);
  const [sheet, setSheet] = useState(0);
  const [table, setTable] = useState<ImportTable>('pfmea');
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Record<number, string>>({});

  useEffect(() => {
    api.readGrid().then((f) => {
      if (!f) return onClose();
      setFile(f);
      const i = Math.max(0, f.sheets.findIndex((s) => /pfmea/i.test(s.name)));
      setSheet(i);
    }).catch((e) => {
      toast(`Dosya okunamadı: ${e instanceof Error ? e.message : e}`, 'err');
      onClose();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = file?.sheets[sheet];
  useEffect(() => {
    if (!grid) return;
    const h = detectHeaderRow(grid);
    setHeader(h);
    const name = grid.name.toLowerCase();
    const guess: ImportTable = /dfmea|design/.test(name) ? 'dfmea' : /pfmea|process fmea/.test(name) ? 'pfmea' : /control|kontrol/.test(name) ? 'controlPlan' : /req|gereksinim/.test(name) ? 'requirements' : /lesson|ders/.test(name) ? 'lessons' : /flow|akış/.test(name) ? 'processSteps' : /kc|karakter/.test(name) ? 'kcs' : table;
    setTable(guess);
  }, [grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const headers = useMemo(() => (grid?.rows[header] ?? []).map((h) => (h == null ? '' : String(h))), [grid, header]);
  useEffect(() => setMapping(suggestMapping(headers, table)), [headers, table]);

  const preview = useMemo(() => {
    if (!grid) return null;
    try {
      return applyImport(p, table, grid, header, mapping, { sourceLabel: `${file!.name} / ${grid.name}` });
    } catch (e) {
      return { rows: [], warnings: [String(e)] };
    }
  }, [p, table, grid, header, mapping, file]);

  const run = async () => {
    if (!preview?.rows.length) return;
    const ok = await edit(preview.rows.map((row) => ({ kind: 'add' as const, table, row })), `Excel içe aktarma: ${preview.rows.length} ${TABLE_LABEL[table]}`);
    if (ok) {
      toast(`${preview.rows.length} satır içe aktarıldı`);
      onClose();
    }
  };

  if (!file || !grid) return null;
  const targets = IMPORT_TARGETS[table];
  return (
    <Modal title="Excel FMEA içe aktar" sub={`${file.name} · kolonları eşleyin. Eşleme öneridir; hesaplanan kolonlar (RPN/AP) yeniden hesaplanır.`} icon="⇪" wide onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!preview?.rows.length} onClick={run}>{preview?.rows.length ?? 0} satırı içe aktar</button></>}>
      <div className="form">
        <label><span>Sayfa</span><select className="cell-select" value={sheet} onChange={(e) => setSheet(Number(e.target.value))}>{file.sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} satır)</option>)}</select></label>
        <label><span>Hedef tablo</span><select className="cell-select" value={table} onChange={(e) => setTable(e.target.value as ImportTable)}>{IMPORT_TABLES.map((t) => <option key={t} value={t}>{TABLE_LABEL[t]}</option>)}</select></label>
        <label><span>Başlık satırı</span><input className="cell-input" type="number" min={1} value={header + 1} onChange={(e) => setHeader(Math.max(0, Number(e.target.value) - 1))} /></label>
      </div>
      <div className="table-wrap" style={{ maxHeight: 280 }}>
        <table className="effects map">
          <thead>
            <tr>{headers.map((h, i) => <th key={i} className="small">{cellAddress(header, i).replace(/\d+$/, '')} · {h || '—'}</th>)}</tr>
            <tr>
              {headers.map((_, i) => (
                <th key={i}>
                  <select className="cell-select" value={mapping[i] ?? IGNORE} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}>
                    <option value={IGNORE}>— yok say —</option>
                    <option value={COMPUTED}>Hesaplanan (alınmaz)</option>
                    {targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.slice(header + 1, header + 6).map((r, ri) => (
              <tr key={ri}>{headers.map((_, ci) => <td key={ci} className="small">{r[ci] == null ? '' : String(r[ci]).slice(0, 60)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview && preview.warnings.length > 0 && (
        <div className="callout warn small">
          <b>{preview.warnings.length} uyarı</b>
          <ul className="plain">{preview.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <p className="muted small">İçe aktarılan satırlar “Excel içe aktarma” kaynağıyla işaretlenir; onay durumu boş kalır. Mevcut satırlar değişmez.</p>
    </Modal>
  );
}

