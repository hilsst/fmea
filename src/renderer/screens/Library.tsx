// 4.12.0: Kütüphane ekranı – yerleşik + firma kütüphanesi tek yerde.
// Yerleşik kayıtlar salt okunurdur (yalnız devre dışı bırakılabilir). Firma kayıtları ortak klasördeki fmea-kutuphane.json'a yazılır.
import { useEffect, useMemo, useState } from 'react';
import { TABS, TAB_COLL, TAB_LABEL, cleanRecord, libView, recordFromCells, recordsFromExamples, searchRows, tabFields, type FieldSpec, type LibTab, type ViewRow } from '../../shared/companyLib';
import { api, isDesktop } from '../api';
import { Modal } from '../components/Modal';
import { pickLibDir, reloadLib, useCompanyLib, writeLib } from '../companyLibStore';
import { useStore } from '../store';

const PAGE = 200;
const DISMISS = 'fmea-lib-migrate-dismissed';
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('tr-TR') : '–');

/** Yazma sonucunu kullanıcıya bildirir (birleştirme / reddedilen kayıt dahil). */
export function useLibWrite() {
  const { project, toast } = useStore();
  const by = project.settings.userName?.trim() || 'Kullanıcı';
  return async (ops: Parameters<typeof writeLib>[0], okMsg: string): Promise<boolean> => {
    const r = await writeLib(ops, by);
    if (!r.ok) {
      toast(r.error, 'err');
      return false;
    }
    if (r.rejected.length) toast(`${r.rejected.length} kayıt geçersiz olduğu için eklenmedi: ${[...new Set(r.rejected)].join('; ')}`, 'warn');
    toast(okMsg, 'ok');
    if (r.merged) toast('Kütüphane siz okuduktan sonra başka biri tarafından değiştirilmişti; değişiklikleriniz güncel dosyayla birleştirildi (aynı kayıtta son yazan kazanır).', 'warn');
    for (const w of r.warnings) toast(w, 'warn');
    return true;
  };
}

export function LibraryScreen() {
  const lib = useCompanyLib();
  const { toast, confirm } = useStore();
  const write = useLibWrite();
  const [tab, setTab] = useState<LibTab>('dfmea');
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<'all' | 'Yerleşik' | 'Firma'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [edit, setEdit] = useState<{ row?: ViewRow } | null>(null);
  const [examples, setExamples] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isDesktop) void api.examplesInfo().then((x) => setExamples(x.count)).catch(() => undefined);
  }, []);
  useEffect(() => setLimit(PAGE), [tab, q, src]);

  const all = useMemo(() => libView(lib.co, tab), [lib.co, tab]);
  const rows = useMemo(() => searchRows(src === 'all' ? all : all.filter((r) => r.source === src), q), [all, src, q]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t, libView(lib.co, t).length])) as Record<LibTab, number>, [lib.co]);
  const fields = tabFields(tab);
  const shown = fields.filter((f) => !f.wide || ['failureMode', 'hint'].includes(f.key)).slice(0, 6);
  const canWrite = isDesktop && !!lib.dir && lib.status !== 'unreachable';
  const nCo = lib.co.dfmea.length + lib.co.pfmea.length + lib.co.params.length + lib.co.gauges.length + lib.co.structures.length;

  const remove = async (r: ViewRow) => {
    if (!(await confirm('Firma kaydı silinsin mi?', 'Kayıt ortak kütüphane dosyasından silinir; projelerdeki mevcut satırlar değişmez.', true))) return;
    await write({ remove: [{ coll: TAB_COLL[tab], id: r.id }] }, 'Firma kaydı silindi');
  };
  const toggle = (r: ViewRow) => write(r.disabled ? { enable: [r.id] } : { disable: [r.id] }, r.disabled ? 'Yerleşik kayıt yeniden etkin' : 'Yerleşik kayıt devre dışı bırakıldı (silinmez; geri açılabilir)');

  const exportXlsx = async () => {
    const f = await api.libExportExcel(lib.co);
    if (f) toast(`Kütüphane Excel olarak kaydedildi: ${f}`);
  };
  const importXlsx = async () => {
    const r = await api.libImportExcel();
    if (!r) return;
    if (!r.ok) return toast(r.error, 'err');
    const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
    const dis = (r.ops.disable?.length ?? 0) + (r.ops.enable?.length ?? 0);
    if (!n && !dis) return toast(r.warnings.length ? r.warnings.join(' ') : 'İçe aktarılacak firma kaydı bulunamadı (Kaynak sütunu “Firma” olan satırlar alınır).', 'warn');
    const detail = (Object.entries(r.counts) as [LibTab, number][]).map(([t, c]) => `${TAB_LABEL[t]}: ${c}`).join(', ');
    if (!(await confirm(`${r.name} içe aktarılsın mı?`, `${n} firma kaydı eklenecek / güncellenecek${detail ? ` (${detail})` : ''}${dis ? `; ${dis} yerleşik kaydın durumu değişecek` : ''}. Aynı ID’li kayıtlar güncellenir.${r.warnings.length ? ` Uyarılar: ${r.warnings.join(' ')}` : ''}`))) return;
    await write(r.ops, 'Excel içe aktarıldı');
  };
  const migrate = async () => {
    const pool = await api.examplesList();
    // Daha önce taşınmış (aynı kapsam + hata modu + neden) kayıtlar tekrar eklenmez.
    const k = (scope: string, fm: string, cause: string) => [scope, fm, cause].map((v) => (v ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()).join('|');
    const have = new Set([...lib.co.dfmea.map((c) => k(c.scope, c.failureMode, c.cause)), ...lib.co.pfmea.map((c) => k(c.area, c.failureMode, c.cause))]);
    const recs = recordsFromExamples(pool, undefined).filter((x) => !have.has(k('scope' in x.rec ? x.rec.scope : x.rec.area, x.rec.failureMode, x.rec.cause)));
    if (!recs.length) return toast('Taşınacak yeni örnek bulunamadı (geçerli örnek yok veya hepsi zaten firma kütüphanesinde).', 'warn');
    if (await write({ upsert: recs.map((x) => ({ coll: x.coll, rec: x.rec })) }, `${recs.length} örnek firma kütüphanesine taşındı`)) dismiss();
  };
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS, '1');
    } catch {
      /* yok say */
    }
  };

  return (
    <div className="page">
      <div className="card">
        <h3>Firma kütüphanesi dosyası</h3>
        {lib.status === 'loading' && <p className="muted">Okunuyor…</p>}
        {lib.status === 'nodir' && (
          <p className="muted">
            Firma kütüphanesi klasörü seçilmedi; yalnızca <b>yerleşik</b> kütüphane kullanılıyor. Ortak klasör seçerseniz firma kayıtları <code>fmea-kutuphane.json</code> dosyasında herkesle paylaşılır.
          </p>
        )}
        {lib.status === 'unreachable' && <p className="warn-text">⚠ {lib.error ?? 'Klasöre erişilemiyor.'} Yerleşik kütüphaneyle çalışılıyor; firma kayıtları geçici olarak görünmez.</p>}
        {lib.status === 'corrupt' && <p className="warn-text">⚠ {lib.error} Yerleşik kütüphaneyle çalışılıyor. Bir sonraki yazmada bozuk dosya yedeklenir.</p>}
        {lib.status === 'missing' && <p className="muted">Klasör: <b>{lib.dir}</b> · henüz kütüphane dosyası yok; ilk kayıtta oluşturulur.</p>}
        {lib.status === 'ok' && (
          <p className="small">
            Klasör: <b>{lib.dir}</b> · sürüm (rev) <b>{lib.co.rev}</b> · son değişiklik: {lib.co.updatedBy || '–'}, {when(lib.co.updatedAt)} · <b>{nCo}</b> firma kaydı, <b>{lib.co.disabled.length}</b> devre dışı yerleşik kayıt
          </p>
        )}
        {lib.warnings.map((w, i) => (
          <p key={i} className="warn-text small">⚠ {w}</p>
        ))}
        {isDesktop && (
          <div className="row-btns">
            <button className="btn" onClick={async () => { if (await pickLibDir()) toast('Klasör seçildi'); }}>Klasör seç…</button>
            <button className="btn" onClick={() => void reloadLib()}>↻ Yenile</button>
            <button className="btn" disabled={!canWrite && lib.status !== 'missing'} onClick={exportXlsx}>⬇ Excel’e aktar</button>
            <button className="btn" disabled={!canWrite} onClick={importXlsx} title="Dışa aktarılan biçimdeki Excel dosyasını içe alır: Kaynak = Firma satırları kayıt olur; yerleşik satırlarda yalnız Durum (Etkin / Devre dışı) okunur.">⬆ Excel’den al</button>
          </div>
        )}
        {isDesktop && examples > 0 && canWrite && !dismissed && (
          <div className="card" style={{ marginTop: 10 }}>
            <b>Eski örnek kütüphanesi bulundu.</b> Bu bilgisayarda onayladığınız {examples} satır var. Proje özel sayı ve ID’ler ayıklanarak firma kütüphanesine kopyalanabilir (AI örnek beslemesi yerel kopyayı kullanmaya devam eder).
            <div className="row-btns">
              <button className="btn primary" onClick={migrate}>Firma kütüphanesine taşı</button>
              <button className="btn" onClick={dismiss}>Şimdi değil</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="subtabs" style={{ marginBottom: 10 }}>
          {TABS.map((t) => (
            <button key={t} className={`chip-btn ${t === tab ? 'on' : ''}`} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              <span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="grid-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="search" style={{ width: 280 }} placeholder="Ara… (hata modu, neden, parametre, ölçüm…)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={src} onChange={(e) => setSrc(e.target.value as typeof src)}>
            <option value="all">Tüm kaynaklar</option>
            <option value="Yerleşik">Yalnız yerleşik</option>
            <option value="Firma">Yalnız firma</option>
          </select>
          <span className="muted small">{rows.length} satır</span>
          <span style={{ flex: 1 }} />
          {tab !== 'structures' ? (
            <button className="btn primary" disabled={!canWrite} title={canWrite ? '' : 'Önce firma kütüphanesi klasörünü seçin'} onClick={() => setEdit({})}>+ Firma kaydı ekle</button>
          ) : (
            <span className="muted small">Firma yapı şablonları Excel ile eklenir (⬇ dışa aktar, düzenle, ⬆ içe al).</span>
          )}
        </div>
        <div style={{ overflow: 'auto', maxHeight: '60vh', marginTop: 8 }}>
          <table className="effects" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Kaynak</th>
                {shown.map((f) => <th key={f.key}>{f.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id} style={r.disabled ? { opacity: 0.45 } : undefined}>
                  <td>
                    <span className={`badge ${r.source === 'Firma' ? 'b-green' : 'b-gray'}`}>{r.source}</span>
                    {r.disabled && <div className="small warn-text">devre dışı</div>}
                  </td>
                  {shown.map((f) => (
                    <td key={f.key} title={r.cells[f.key]} style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cells[f.key]}</td>
                  ))}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" onClick={() => setEdit({ row: r })}>{r.source === 'Firma' && tab !== 'structures' && canWrite ? 'Düzenle' : 'Ayrıntı'}</button>{' '}
                    {r.source === 'Firma' ? (
                      <button className="btn" disabled={!canWrite} onClick={() => remove(r)}>Sil</button>
                    ) : (
                      <button className="btn" disabled={!canWrite} onClick={() => toggle(r)}>{r.disabled ? 'Etkinleştir' : 'Devre dışı bırak'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <button className="btn" style={{ margin: 8 }} onClick={() => setLimit(limit + PAGE)}>Daha fazla göster ({rows.length - limit} satır daha)</button>}
          {!rows.length && <p className="muted" style={{ padding: 12 }}>Bu filtrede kayıt yok.</p>}
        </div>
      </div>
      {edit && <RecordDialog tab={tab} row={edit.row} readOnly={!!edit.row && (edit.row.source !== 'Firma' || tab === 'structures' || !canWrite)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RecordDialog({ tab, row, readOnly, onClose }: { tab: LibTab; row?: ViewRow; readOnly: boolean; onClose: () => void }) {
  const write = useLibWrite();
  const fields = tabFields(tab);
  const [cells, setCells] = useState<Record<string, string>>(() => ({ ...(row?.cells ?? {}) }));
  const [err, setErr] = useState('');
  const save = async () => {
    const { coll, rec } = recordFromCells(tab, cells, row?.source === 'Firma' ? row.id : undefined);
    const c = cleanRecord(coll, rec);
    if ('error' in c) return setErr(`Kayıt kaydedilemedi: ${c.error}`);
    if (await write({ upsert: [{ coll, rec: { ...(row?.rec ?? {}), ...rec } }] }, row ? 'Firma kaydı güncellendi' : 'Firma kaydı eklendi')) onClose();
  };
  const field = (f: FieldSpec) => {
    const v = cells[f.key] ?? '';
    const set = (x: string) => setCells({ ...cells, [f.key]: x });
    if (f.type === 'select') {
      const opts = f.options ?? [];
      return (
        <select value={v} disabled={readOnly} onChange={(e) => set(e.target.value)}>
          <option value="" />
          {[...new Set([...(v && !opts.includes(v) ? [v] : []), ...opts])].map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    }
    if (f.type === 'long') return <textarea rows={2} value={v} disabled={readOnly} style={{ width: '100%' }} onChange={(e) => set(e.target.value)} />;
    return <input value={v} disabled={readOnly} style={{ width: f.type === 'num' ? 70 : '100%' }} inputMode={f.type === 'num' ? 'numeric' : undefined} onChange={(e) => set(e.target.value)} />;
  };
  return (
    <Modal
      title={readOnly ? 'Kayıt ayrıntısı' : row ? 'Firma kaydını düzenle' : 'Firma kaydı ekle'}
      sub={readOnly ? (row?.source === 'Yerleşik' ? 'Yerleşik kayıtlar salt okunurdur; devre dışı bırakabilirsiniz.' : 'Firma yapı şablonları Excel ile düzenlenir.') : 'Kütüphaneden gelen her satır AI Proposed ve güven Low eklenir; onay mühendistedir. Sayı girerseniz satır kaynağına “Firma kütüphanesi” yazılır ve değer yine onay bekler. API anahtarı veya kişisel veri yazmayın.'}
      icon="📚"
      wide
      onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>{readOnly ? 'Kapat' : 'Vazgeç'}</button>{!readOnly && <button className="btn primary" onClick={save}>Kaydet</button>}</>}
    >
      {err && <p className="warn-text">{err}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '6px 10px', alignItems: 'start' }}>
        {fields.map((f) => (
          <div key={f.key} style={{ display: 'contents' }}>
            <label className="small" style={{ paddingTop: 4 }}>{f.label}{f.required ? ' *' : ''}</label>
            <div>{field(f)}{f.key === 'match' && !readOnly && <div className="muted small">Boş bırakırsanız ad kullanılır. Birden çok anahtar kelime için virgül kullanın.</div>}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
