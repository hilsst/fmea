// v4-kc: SCMH / AS9145 KC–CI ekran bölümleri: seçili KC paneli (tetikleyiciler, karar akışı, yaşam döngüsü),
// Adaylar & Karar Akışı, İzlenebilirlik & 7.2.16 KC Traceability Form önizlemesi.
// Motor önerileri adaydır; her karar mühendisin tıklamasıyla ve onay penceresi / denetim iziyle uygulanır.
import { useState } from 'react';
import { rowLabel } from '../../shared/columns';
import { kcFormRows, KC_FORM_TEMPLATE_FILE } from '../../shared/kcForm';
import {
  DECISION_QUESTIONS,
  KC_ELIMINATED_BY,
  lifecycleLabel,
  isCi,
  isInactive,
  isListed,
  kcDisplayNo,
  kcTypeOf,
  scmhKcDecision,
  type ScmhKcDecision,
} from '../../shared/kcScmh';
import { kcCandidates, kcTriggers, processKcCandidates } from '../../shared/kcTriggers';
import { kcTraceRows, pfRowsOfKc, stepsOfKc, cpRowsOfKc, dfRowsOfKc } from '../../shared/kcTrace';
import { nextId } from '../../shared/model';
import type { Edit } from '../../shared/engine';
import type { AnyRow, KcRow, ProjectMeta, Settings } from '../../shared/types';
import { TextCell } from '../components/Cells';
import { Modal } from '../components/Modal';
import { useStore } from '../store';

const set = (id: string, field: string, value: unknown): Edit => ({ kind: 'set', table: 'kcs', id, field, value });

// ───────────────────────── seçili KC paneli ─────────────────────────

export function KcScmhPanel({ id }: { id?: string }) {
  const { project: p, edit, toast } = useStore();
  const [elim, setElim] = useState(false);
  const kc = p.kcs.find((k) => k.id === id);
  if (!kc) return <aside className="card tree"><h3>KC / CI değerlendirmesi</h3><p className="muted">Tetikleyicileri, SCMH karar akışını ve izlenebilirliği görmek için bir satır seçin.</p></aside>;
  const src = [...p.dfmea, ...p.pfmea].find((r) => r.id === kc.sourceId);
  const trig = src ? kcTriggers(p, src) : [];
  const d = scmhKcDecision(kc);
  const answer = (field: string, v: string) => edit(set(kc.id, field, v), 'SCMH KC karar akışı');
  const confirm = () => {
    if (!d.complete || d.outcome === 'Not a KC' || d.outcome === 'Not a Critical Item')
      return toast('Kesinleştirmeden önce karar akışını tamamlayın; sonuç “KC değil” ise KC kesinleştirilemez. Severity tek başına KC kararı değildir.', 'warn');
    const edits: Edit[] = [set(kc.id, 'lifecycle', 'Confirmed')];
    if (kc.status !== 'Approved') edits.push(set(kc.id, 'status', 'Approved'));
    return edit(edits, `${kc.id} kesinleştir`);
  };
  return (
    <aside className="card tree">
      <h3>{kcDisplayNo(kc)} · {isCi(kc) ? 'Critical Item' : `${kcTypeOf(kc)} KC`}</h3>
      <p className="small"><b>Durum:</b> {lifecycleLabel(kc)} · {kc.status || '—'}{kc.customerAgreed ? ' · müşteri mutabık' : ''}</p>
      <div className="grid-toolbar">
        <button className="btn" onClick={() => edit(set(kc.id, 'lifecycle', 'Preliminary'), `${kc.id} ön liste`)} disabled={kc.lifecycle === 'Preliminary'}>Ön liste</button>
        <button className="btn" onClick={() => edit(set(kc.id, 'lifecycle', 'Potential'), `${kc.id} potansiyel`)} disabled={kc.lifecycle === 'Potential'}>Potansiyel</button>
        <button className="btn ok" onClick={confirm} disabled={kc.lifecycle === 'Confirmed'}>Kesinleştir</button>
        <button className="btn danger" onClick={() => setElim(true)} disabled={kc.lifecycle === 'Eliminated'}>Ele…</button>
      </div>

      <h4>Aday tetikleyicileri</h4>
      {src ? (
        <ul className="checks">
          {trig.map((t) => (
            <li key={t.key} className={t.on ? 'bad' : 'ok'}>
              <span className="mark">{t.on ? '!' : '–'}</span>
              <div><b>{t.label}</b><div className="muted small">{t.reason}</div></div>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Kaynak FMEA satırı yok (müşteri KC’si / gereksinim kaynaklı).</p>}
      <p className="muted small">Tetikleyici yalnızca adaydır (CPQA Q10, DRA Q&A Q21). KC kararı aşağıdaki akışla mühendis tarafından verilir.</p>

      <h4>SCMH KC karar akışı</h4>
      <DecisionFlow kc={kc} d={d} onAnswer={answer} />

      <h4>İzlenebilirlik</h4>
      <table className="effects small">
        <tbody>
          <tr><td>DFMEA</td><td>{dfRowsOfKc(p, kc).map((r) => r.id).join(', ') || '—'}</td></tr>
          <tr><td>PFMEA</td><td>{pfRowsOfKc(p, kc).map((r) => r.id).join(', ') || '—'}</td></tr>
          <tr><td>PFD</td><td>{stepsOfKc(p, kc).map((s) => s.opNo || s.id).join(', ') || '—'}</td></tr>
          <tr><td>Kontrol Planı</td><td>{cpRowsOfKc(p, kc).map((c) => c.id).join(', ') || '—'}</td></tr>
        </tbody>
      </table>
      {elim && <EliminateDialog kc={kc} onClose={() => setElim(false)} />}
    </aside>
  );
}

function DecisionFlow({ kc, d, onAnswer }: { kc: KcRow; d: ScmhKcDecision; onAnswer: (field: string, v: string) => void }) {
  // Cevaplanmış sorular + sıradaki soru gösterilir (akış dalına göre).
  const order: (keyof typeof DECISION_QUESTIONS)[] = ['qSafetyCritical', 'qCriticalOther', 'qUnsafe', 'qAffectsOther', 'qVariation'];
  const shown = order.filter((q) => (kc[q] && d.path.some((x) => x.startsWith(label(q)))) || q === d.next);
  return (
    <div className="small">
      {shown.map((q) => (
        <div key={q} style={{ margin: '4px 0' }}>
          <div>{DECISION_QUESTIONS[q]}</div>
          {(['Yes', 'No'] as const).map((v) => (
            <label key={v} style={{ marginRight: 12 }}>
              <input type="radio" name={`${kc.id}-${q}`} checked={kc[q] === v} onChange={() => onAnswer(q, v)} /> {v === 'Yes' ? 'Evet' : 'Hayır'}
            </label>
          ))}
        </div>
      ))}
      <p>
        <b>Sonuç:</b>{' '}
        {d.complete ? <span className="badge b-amber">{d.ci ? 'Critical Item · ' : ''}{d.outcome}</span> : <span className="muted">akış tamamlanmadı</span>}
      </p>
      {d.outcome.startsWith('Safety-related Frozen') && <p className="muted small">Varyasyon yönetimi uygun değil: dondurulmuş proses / zorunlu prosedür elemanı olarak kontrol planında yönetin (capability çalışması gerekmez – çıkarım).</p>}
      <p className="muted small">Kaynak: SCMH CAP webinar p54 / DRA webinar slide 43. Sonuç mühendisin cevaplarından hesaplanır.</p>
    </div>
  );
}

const label = (q: string) =>
  ({ qSafetyCritical: 'Safety critical', qCriticalOther: 'Critical to other', qUnsafe: 'Create unsafe', qAffectsOther: 'Affect other', qVariation: 'Benefit from' })[q] ?? q;

function EliminateDialog({ kc, onClose }: { kc: KcRow; onClose: () => void }) {
  const { edit, toast } = useStore();
  const [by, setBy] = useState(kc.eliminatedBy || '');
  const [ref, setRef] = useState(kc.eliminatedRef || '');
  const [note, setNote] = useState(kc.eliminationNote || '');
  const go = async () => {
    if (!by || !note.trim()) return toast('Eleme yolu ve gerekçe zorunludur (SCMH 7.2.17 §1.2.8).', 'warn');
    const ok = await edit([set(kc.id, 'eliminatedBy', by), set(kc.id, 'eliminatedRef', ref), set(kc.id, 'eliminationNote', note.trim()), set(kc.id, 'lifecycle', 'Eliminated')], `${kc.id} elendi`);
    if (ok) onClose();
  };
  return (
    <Modal title={`${kcDisplayNo(kc)} ele`} sub="Elenen KC silinmez; numarası tekrar kullanılmaz ve KC Traceability Form’da N/A ile kalır." icon="⊘" onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn danger" onClick={go}>Ele</button></>}>
      <div className="form">
      <label><span>Eleme yolu</span>
        <select className="cell-select" value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">—</option>
          {KC_ELIMINATED_BY.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label><span>Referans (tasarım değişikliği / aksiyon / CR)</span><input className="cell-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      <label><span>Gerekçe (özel/ihracat kontrollü bilgi yazmayın)</span><textarea className="cell-input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ───────────────────────── Adaylar & karar akışı ─────────────────────────

export function KcFlowScreen() {
  const { project: p, edit, toast } = useStore();
  const cands = kcCandidates(p);
  const proc = processKcCandidates(p);
  const setSetting = (field: keyof Settings) => (v: unknown) => edit({ kind: 'settings', field, value: v === '' || v == null ? null : Number(v) }, 'SCMH inceleme listesi');
  const setText = (field: keyof Settings) => (v: unknown) => edit({ kind: 'settings', field, value: String(v ?? '') }, 'KC numaralandırma');

  const addKc = async (data: Partial<KcRow>, title: string) => {
    const id = nextId(p, 'kcs');
    const ok = await edit({ kind: 'add', table: 'kcs', row: { id, ...data } as unknown as AnyRow }, title);
    if (ok) toast(`${id} oluşturuldu (Potansiyel) – karar akışını KC listesinde tamamlayın`);
  };
  const fromCandidate = (c: (typeof cands)[number]) => {
    const pf = 'stepId' in c.row;
    return addKc({
      sourceId: c.row.id,
      characteristic: c.row.requirement || ('function' in c.row ? c.row.function : c.row.processFunction) || c.row.failureMode,
      severity: c.row.s,
      kcType: pf ? 'Process' : 'Product',
      lifecycle: 'Potential',
      status: 'Engineer Reviewed',
      origin: 'manual',
      triggers: c.triggers.map((t) => t.key),
      rationale: `Aday tetikleyicileri: ${c.triggers.map((t) => t.reason || t.label).join('; ')}`,
    }, `${c.row.id} için KC adayı`);
  };

  return (
    <div className="page">
      <section className="card">
        <h3>KC aday tetikleyicileri</h3>
        <p className="muted small">Severity, emniyet, S×O, S×D, O×D, RPN (Top-N inceleme listesi), müşteri ve Special Requirement. Liste adaydır; KC kararı karar akışıyla verilir (RPN veya severity tek başına karar değildir).</p>
        {cands.length === 0 ? <p className="muted">Tetikleyicisi olan satır yok.</p> : (
          <table className="effects small">
            <thead><tr><th>Satır</th><th>Tetikleyiciler</th><th>KC kaydı</th><th /></tr></thead>
            <tbody>
              {cands.map((c) => (
                <tr key={c.row.id}>
                  <td>{rowLabel(p, c.row.id)}</td>
                  <td>{c.triggers.map((t) => `${t.label}${t.reason ? ` (${t.reason})` : ''}`).join(' · ')}</td>
                  <td>{c.kcs.map((k) => `${kcDisplayNo(k)} ${lifecycleLabel(k)}`).join(', ') || '—'}</td>
                  <td>{c.kcs.length === 0 && <button className="btn" onClick={() => fromCandidate(c)}>KC adayı oluştur</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Proses KC kuralı (SCMH 7.2.3 p63)</h3>
        <p className="muted small">PFMEA’da yüksek riskli (S 9–10 veya ekip eşiğini aşan S×D / O×D / RPN) ve riski tasarım aksiyonuyla (O/S azaltma) düşürülemeyen satırlar proses KC adayıdır. Proses KC, varyasyonu süren proses girdisine (proses parametresi) atanır ve kontrol planında %100 kontrol veya SPC ile izlenir.</p>
        {proc.length === 0 ? <p className="muted">Açık satır yok.</p> : (
          <table className="effects small">
            <thead><tr><th>PFMEA</th><th>Yüksek risk</th><th>Proses parametresi</th><th>Tasarımla azaltılabilir?</th><th /></tr></thead>
            <tbody>
              {proc.map((c) => (
                <tr key={c.row.id}>
                  <td>{rowLabel(p, c.row.id)}</td>
                  <td>{c.why.join('; ')}</td>
                  <td>{c.ppIds.join(', ') || <span className="muted">bağlı parametre yok</span>}</td>
                  <td>
                    <button className="btn" onClick={() => edit({ kind: 'set', table: 'pfmea', id: c.row.id, field: 'designActionFeasible', value: 'Yes' }, 'Tasarım aksiyonu')}>Evet</button>{' '}
                    <button className="btn" onClick={() => edit({ kind: 'set', table: 'pfmea', id: c.row.id, field: 'designActionFeasible', value: 'No' }, 'Tasarım aksiyonu')} disabled={!c.needsAnswer}>Hayır</button>
                  </td>
                  <td>
                    {!c.needsAnswer && (
                      <button className="btn" onClick={() => addKc({
                        sourceId: c.row.id, characteristic: c.characteristic, severity: c.row.s, kcType: 'Process', kcClass: 'KC-3 Process KC', ppIds: c.ppIds,
                        lifecycle: 'Potential', status: 'Engineer Reviewed', origin: 'manual', triggers: ['Process rule'],
                        relatedKcIds: p.kcs.filter((k) => !isInactive(k) && kcTypeOf(k) === 'Product' && pfRowsOfKc(p, k).some((x) => x.id === c.row.id)).map((k) => k.id),
                        rationale: `7.2.3 p63: ${c.why.join('; ')}; tasarım aksiyonuyla azaltılamaz`,
                      }, `${c.row.id} proses KC adayı`)}>Proses KC adayı oluştur</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>İnceleme listesi ve numaralandırma</h3>
        <p className="muted small">SCMH S×O / S×D / O×D / RPN için sayısal eşik vermez (DFMEA Guidance O19). S×O, S×D, O×D ve RPN tetikleyicileri ekibin “Top-N” inceleme listesini kullanır (Risk ekranıyla aynı ayar); boş = yalnızca sıralama.</p>
        <div className="form">
          <label><span>İnceleme listesi (ilk N satır)</span><TextCell type="number" value={p.settings.scmhReviewTopN} onCommit={setSetting('scmhReviewTopN')} /></label>
          <label><span>KC numarası ({'{PN}'}, {'{nnn}'})</span><TextCell value={p.settings.kcNumbering} onCommit={setText('kcNumbering')} /></label>
          <label><span>CI numarası</span><TextCell value={p.settings.ciNumbering} onCommit={setText('ciNumbering')} /></label>
        </div>
        <p className="muted small">Numara, KC listeye alındığında (Ön liste / Potansiyel / Kesinleşmiş veya mühendis incelemesi) bir kez verilir; silinen veya elenen numara tekrar kullanılmaz (SCMH 7.2.17 §1.2.1).</p>
      </section>
    </div>
  );
}

// ───────────────────────── İzlenebilirlik & 7.2.16 ─────────────────────────

const FORM_META: [keyof ProjectMeta, string][] = [
  ['kcFormRevision', 'Revision (of this sheet)'],
  ['kcFormDate', 'Date Completed'],
  ['kcContacts', 'Contact Name(s)'],
];

export function KcTraceScreen() {
  const { project: p, edit, mutate, toast } = useStore();
  const rows = kcTraceRows(p);
  const form = kcFormRows(p);
  const setMeta = (k: keyof ProjectMeta) => (v: unknown) => {
    mutate((d) => { d.meta[k] = String(v ?? ''); }, { kind: 'Modified', table: 'meta', id: 'meta', field: k, to: String(v ?? '') });
    return Promise.resolve(true);
  };
  const fixCp = (cpId: string, how: '100' | 'spc') => {
    const c = p.controlPlan.find((x) => x.id === cpId)!;
    return how === '100'
      ? edit({ kind: 'set', table: 'controlPlan', id: cpId, field: 'sampleSize', value: '100%' }, 'Proses KC: %100 kontrol')
      : edit({ kind: 'set', table: 'controlPlan', id: cpId, field: 'controlMethod', value: [c.controlMethod, 'SPC'].filter(Boolean).join(' + ') }, 'Proses KC: SPC');
  };
  const listed = p.kcs.filter((k) => isListed(k) && !isInactive(k));
  const agree = async () => {
    if (!p.meta.kcListAgreedBy.trim() || !p.meta.kcListAgreedDate.trim()) return toast('Önce müşteri temsilcisini ve mutabakat tarihini girin.', 'warn');
    const ok = await edit(listed.filter((k) => !k.customerAgreed).map((k) => set(k.id, 'customerAgreed', true)), 'KC listesi müşteri mutabakatı');
    if (ok) toast(`${listed.length} KC/CI müşteriyle mutabık işaretlendi`);
  };
  return (
    <div className="page">
      <section className="card">
        <h3>KC izlenebilirliği (DFMEA → PFD → PFMEA → Kontrol Planı)</h3>
        <p className="muted small">Aynı KC numarası tüm dokümanlarda kullanılır (7.2.16). DFMEA KC’leri PFMEA’ya “Bağlı DFMEA” (dfIds) üzerinden, PFD’ye adımın PFMEA / kontrol planı satırlarıyla akar.</p>
        {rows.length === 0 ? <p className="muted">KC yok.</p> : (
          <table className="effects small">
            <thead><tr><th>No</th><th>Tip</th><th>Durum</th><th>DFMEA</th><th>PFMEA</th><th>PFD</th><th>Kontrol Planı</th><th>Eksik</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kc.id}>
                  <td>{r.no}</td>
                  <td>{isCi(r.kc) ? 'CI' : kcTypeOf(r.kc)}</td>
                  <td>{lifecycleLabel(r.kc)}</td>
                  <td>{r.df.join(', ') || '—'}</td>
                  <td>{r.pf.join(', ') || '—'}</td>
                  <td>{r.steps.join(', ') || '—'}</td>
                  <td>{r.cp.join(', ') || '—'}</td>
                  <td>
                    {r.gaps.length ? <span className="gap-t">{r.gaps.join(', ')}</span> : '✓'}
                    {r.cpWithoutControl.map((id) => (
                      <div key={id}>{id}: <button className="btn" onClick={() => fixCp(id, '100')}>%100</button> <button className="btn" onClick={() => fixCp(id, 'spc')}>SPC</button></div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Müşteri mutabakatı (SCMH 7.2.3 p22)</h3>
        <p className="muted small">“A preliminary listing of CIs and KCs agreed upon between supplier and customer.” Mutabakat mühendis tarafından kaydedilir; mutabakattan sonra değişen KC’nin işareti otomatik düşer.</p>
        <div className="form">
          <label><span>Müşteri temsilcisi</span><TextCell value={p.meta.kcListAgreedBy} onCommit={setMeta('kcListAgreedBy')} /></label>
          <label><span>Tarih</span><TextCell type="date" value={p.meta.kcListAgreedDate} onCommit={setMeta('kcListAgreedDate')} /></label>
          <label><span>Referans (e-posta / toplantı / doküman)</span><TextCell value={p.meta.kcListAgreementRef} onCommit={setMeta('kcListAgreementRef')} /></label>
        </div>
        <p className="small">{listed.filter((k) => k.customerAgreed).length} / {listed.length} KC/CI mutabık. <button className="btn" onClick={agree} disabled={!listed.length}>Listeyi mutabık işaretle</button></p>
      </section>

      <section className="card">
        <h3>SCMH 7.2.16 KC Traceability Form</h3>
        <p className="muted small">SCMH paketi dışa aktarılırken şablon klasöründe <code>{KC_FORM_TEMPLATE_FILE}</code> varsa form doldurulur. Elenen KC’ler N/A ile formda kalır.</p>
        <div className="form">
          {FORM_META.map(([k, l]) => (
            <label key={k}><span>{l}</span><TextCell type={k === 'kcFormDate' ? 'date' : 'text'} value={p.meta[k]} onCommit={setMeta(k)} /></label>
          ))}
        </div>
        <table className="effects small">
          <thead><tr><th>KC No.</th><th>Description</th><th>Requirement</th><th>Reference</th><th>Impact</th><th>Severity</th><th>Originating</th><th>Notes</th></tr></thead>
          <tbody>
            {form.map((r) => (
              <tr key={r.id}>{(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const).map((c) => <td key={c} style={{ whiteSpace: 'pre-wrap' }}>{String(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
