// FMEA Studio 2.0 ekranları: gösterge paneli, risk/AP, KC faktörleri, capability analizi, bilgi tabanı,
// değişiklik etkisi, kalite, AI inceleme, onay akışı, denetim izi, baseline ve ayarlar.
import { useEffect, useMemo, useState } from 'react';
import { AI_ERROR_TEXT, LOW_CONF_TEXT, REVIEW_CATEGORIES } from '../../shared/aischema';
import { appendBaseline, baselineProject, createBaseline, diffProjects, diffSummary, verifyBaseline, type RowDiff } from '../../shared/baseline';
import { rowLabel } from '../../shared/columns';
import { verifySource } from '../../shared/docmodel';
import { impactOf } from '../../shared/impact';
import { COMPOSITE_KB, PRODUCT_TYPES, PRODUCT_TYPE_HINTS } from '../../shared/kb';
import { FlowTemplatePicker } from '../components/FlowTemplates';
import { evaluateKc } from '../../shared/kc';
import { DEFAULT_SCORING, DEFAULT_SETTINGS, TABLE_LABEL, nextId, tableOfId } from '../../shared/model';
import { failedRunEdit } from '../../shared/proposals';
import { QUALITY_SCORE_NOTE, qualityReport, whatDidIMiss } from '../../shared/quality';
import { buildReviewReportHtml, type AiReview } from '../../shared/report';
import { AIAG_VDA_AP, D_BANDS, O_BANDS, RPN_WARNING, S_BANDS, apOf, parseData } from '../../shared/scoring';
import { SCMH_SCORING, isScmh } from '../../shared/scmhScoring'; // v4-risk: öncelik tablosu Risk.tsx'e taşındı
import { searchLessons } from '../../shared/similarity';
import { applyTemplate, makeTemplate, validateTemplate, type CompanyTemplate } from '../../shared/template';
import { ROLES, WORKFLOW_STEPS, type AnyRow, type ApprovalRecord, type EvidenceRow, type KcRules, type Project, type Settings } from '../../shared/types';
import { approvedSteps, currentStep, decisionError, enabledSteps, openCriticalAi, recordDecision } from '../../shared/workflow';
import { unaddressed } from '../../shared/risk'; // v4-risk
import { ScmhPriorityPanel } from './Risk'; // v4-risk
import type { ScreenKey } from '../../shared/nav';
import { api, isDesktop } from '../api';
import { projectContext } from '../components/AiDialogs';
import { Grid } from '../components/Grid';
import { Modal } from '../components/Modal';
import { useStore } from '../store';
import { ScoringTab } from '../tabs/AnalysisTabs';

export type Go = (screen: ScreenKey, sub?: string) => void;

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s: string) => (s ? new Date(s).toLocaleString('tr-TR') : '');

// ───────────────────────── Gösterge paneli ─────────────────────────

export function DashboardScreen({ go }: { go: Go }) {
  const { project: p } = useStore();
  const q = useMemo(() => qualityReport(p), [p]);
  const step = currentStep(p);
  const fm = [...p.dfmea, ...p.pfmea];
  const apH = fm.filter((r) => apOf(p, r.s, r.o, r.d) === 'H').length;
  const aiPending = [...p.requirements, ...p.dfmea, ...p.pfmea].filter((r) => r.approval === 'AI Proposed').length + p.kcs.filter((k) => k.status === 'AI Proposed').length;
  const openAct = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length;
  const overdue = p.actions.filter((a) => a.dueDate && a.status !== 'Completed' && a.status !== 'Cancelled' && a.dueDate < today()).length;
  const reassess = [...p.requirements, ...p.dfmea, ...p.pfmea, ...p.processSteps, ...p.structure, ...p.controlPlan].filter((r) => r.reassess).length;
  const unverified = p.evidence.filter((e) => e.verification !== 'VERIFIED' && e.verification !== 'VERIFIED – farklı konum').length;
  const errors = q.level2.filter((f) => f.kind === 'FMEA LOGIC ERROR').length;
  const [ai, setAi] = useState<{ configured: boolean; online: boolean; provider: string } | null>(null);
  useEffect(() => {
    if (isDesktop) api.aiStatus().then(setAi);
  }, []);

  const tiles: { label: string; value: number | string; go: [ScreenKey, string?]; tone?: string }[] = [
    { label: 'Gereksinim', value: p.requirements.length, go: ['requirements'] },
    { label: 'DFMEA satırı', value: p.dfmea.length, go: ['dfmea', 'dfmea'] },
    { label: 'PFMEA satırı', value: p.pfmea.length, go: ['pfmea', 'pfmea'] },
    isScmh(p)
      ? { label: 'SCMH inceleme: aksiyon/karar bekleyen (S≥9 / Top-N / KC)', value: unaddressed(p).length, go: ['risk'], tone: unaddressed(p).length ? 'red' : '' } // v4-risk
      : { label: 'AP = High', value: apH, go: ['risk'], tone: apH ? 'red' : '' },
    { label: 'AI önerisi (karar bekliyor)', value: aiPending, go: ['aiReview', 'aiRuns'], tone: aiPending ? 'amber' : '' },
    { label: 'Mantık hatası', value: errors, go: ['quality'], tone: errors ? 'red' : '' },
    { label: 'Doğrulanmamış kanıt', value: unverified, go: ['documents', 'evidence'], tone: unverified ? 'amber' : '' },
    { label: 'Açık aksiyon', value: openAct, go: ['actions'], tone: openAct ? 'blue' : '' },
    { label: 'Geciken aksiyon', value: overdue, go: ['actions'], tone: overdue ? 'red' : '' },
    { label: 'Yeniden değerlendirme', value: reassess, go: ['impact', 'impact'], tone: reassess ? 'amber' : '' },
  ];

  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <div className="score-head">
            <div className={`gauge ${q.score >= 80 ? 'green' : q.score >= 50 ? 'amber' : 'red'}`} style={{ ['--p' as string]: q.score }}>
              <span>{q.score}</span>
            </div>
            <div>
              <h3>{q.label}</h3>
              <p className="muted">{QUALITY_SCORE_NOTE}</p>
              <button className="link" onClick={() => go('quality')}>Ayrıntılar →</button>
            </div>
          </div>
          <div className="dims">
            {q.dimensions.map((d) => (
              <div key={d.key} className="dim" title={d.detail}>
                <span>{d.label}</span>
                <div className="bar"><i style={{ width: `${d.applicable ? d.score : 0}%` }} /></div>
                <b>{d.applicable ? d.score : '—'}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Onay durumu</h3>
          <ol className="wf">
            {enabledSteps(p).map((s) => {
              const done = approvedSteps(p).has(s.step);
              return (
                <li key={s.step} className={done ? 'done' : s.step === step ? 'cur' : ''}>
                  <span className="mark">{done ? '✓' : s.step === step ? '●' : '○'}</span> {s.step} <span className="muted small">{s.role}</span>
                </li>
              );
            })}
          </ol>
          <button className="btn" onClick={() => go('approval', 'workflow')}>Onay ekranına git</button>
          <h3 className="mt">AI durumu</h3>
          <p className="muted">
            {!isDesktop ? 'AI yalnızca masaüstü uygulamasında çalışır.' : ai == null ? '…' : !ai.online ? AI_ERROR_TEXT.OFFLINE : ai.configured ? `Bağlı (${ai.provider}). Mod: ${p.settings.aiMode === 'strict' ? 'Strict Engineering' : 'Engineering Knowledge'}` : 'API anahtarı yok – AI kapalı. Çekirdek FMEA işlevleri çalışır.'}
          </p>
        </section>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.label} className={`tile ${t.tone ?? ''}`} onClick={() => go(...t.go)}>
            <div className="tile-v">{t.value}</div>
            <div className="tile-l">{t.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Proje: ürün tipi ─────────────────────────

export function ProductTypeCard() {
  const { project: p, edit } = useStore();
  const hints = PRODUCT_TYPE_HINTS[p.settings.productType] ?? [];
  return (
    <section className="card">
      <h3>Ürün tipi</h3>
      <p className="muted">Ürün tipi bilgi tabanı önerilerini, proses şablonunu ve “Neyi kaçırdım?” kontrollerini belirler. Değer üretmez.</p>
      <select className="cell-select" value={p.settings.productType} onChange={(e) => edit({ kind: 'settings', field: 'productType', value: e.target.value }, 'Ürün tipi')}>
        <option value="">—</option>
        {PRODUCT_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      {hints.length > 0 && <ul className="plain small mt">{hints.map((h) => <li key={h}>{h}</li>)}</ul>}
      <h3 className="mt">Malzeme ve proses akışı şablonları</h3>
      <p className="muted">Parça malzemesine göre önerilen akışlar işaretli gelir; birden çok akış seçebilirsiniz (örn. kompozit + talaşlı + montaj).</p>
      <FlowTemplatePicker />
    </section>
  );
}

// ───────────────────────── Risk (S/O/D + AP tablosu) ─────────────────────────

const LEVELS = ['H', 'M', 'L'] as const;

/** DFMEA / PFMEA ekran ve Excel kolon düzeni (Ayarlar ve Risk ekranlarında). */
export function TableFormatSetting({ first = false }: { first?: boolean }) {
  const { project: p, mutate } = useStore();
  return (
    <>
      <h3 style={first ? undefined : { marginTop: 14 }}>DFMEA / PFMEA tablo düzeni</h3>
      <div className="row-btns">
        {([['SCMH', 'IAQG SCMH 7.2.10 / 7.2.11', 'Item, Function, Requirement … SEV×OCC, RPN, Classification, Action Results'], ['F33', 'Şirket formu F33.03 / F05.04', 'Op. (Line) #, Process Step # … Predicted Risk ve Action Results Achieved']] as const).map(([k, label, hint]) => (
          <label key={k} className="check-row" title={hint}>
            <input
              type="radio"
              checked={(p.settings.tableFormat ?? 'SCMH') === k}
              onChange={() => mutate((d) => { d.settings.tableFormat = k; }, { kind: 'Modified', table: 'settings', id: 'tableFormat', field: 'tableFormat', from: p.settings.tableFormat ?? 'SCMH', to: k, comment: 'DFMEA/PFMEA tablo düzeni' })}
            />{' '}
            <b>{label}</b>
          </label>
        ))}
      </div>
      <p className="muted small">Yalnızca ekran ve Excel kolon sırasını değiştirir; veriler, otomatik doldurma, onay ve puanlama kuralları aynı kalır.</p>
    </>
  );
}

export function RiskScreen() {
  const { project: p, mutate, confirm } = useStore();
  const custom = !!p.scoring.apTable;
  const table = p.scoring.apTable ?? AIAG_VDA_AP;
  // AP hesaplanan bir değerdir; tablo değişince AP'si değişecek satırlar kaydetmeden önce gösterilir.
  const setTable = async (next: Record<string, string> | null, title: string) => {
    const changed = [...p.dfmea, ...p.pfmea].filter((r) => apOf(p, r.s, r.o, r.d) !== apOf({ scoring: { apTable: next } }, r.s, r.o, r.d));
    if (changed.length && !(await confirm(title, `Bu değişiklik ${changed.length} FMEA satırının AP değerini değiştiriyor:\n${changed.slice(0, 15).map((r) => `${r.id}: ${apOf(p, r.s, r.o, r.d)} → ${apOf({ scoring: { apTable: next } }, r.s, r.o, r.d)}`).join('\n')}${changed.length > 15 ? '\n…' : ''}\n\nOnaylıyor musunuz?`))) return;
    mutate((d) => {
      d.scoring.apTable = next;
    }, { kind: 'Modified', table: 'scoring', id: 'apTable', field: 'apTable', comment: `${title} · ${changed.length} satırın AP değeri değişti` });
  };
  const setCell = (key: string, di: number, v: string) => {
    const base = { ...(p.scoring.apTable ?? AIAG_VDA_AP) };
    const row = (base[key] ?? 'LLLL').split('');
    row[di] = v;
    base[key] = row.join('');
    setTable(base, `AP tablosu: S${key.split(',')[0]} O${key.split(',')[1]} D bandı ${D_BANDS[di]} → ${v}`);
  };
  const scmh = isScmh(p);
  const setStandard = async (std: 'SCMH' | 'AIAG-VDA') => {
    if (std === p.settings.scoringStandard) return;
    const tables = std === 'SCMH' ? SCMH_SCORING : DEFAULT_SCORING;
    if (!(await confirm(`Puanlama standardı ${std === 'SCMH' ? 'IAQG SCMH' : 'AIAG-VDA 2019'} olacak`, `S/O/D kriter metinleri bu standardın tablolarıyla değiştirilir. Satırlardaki mevcut S/O/D puanları DEĞİŞMEZ; yeni kriterlere göre yeniden değerlendirilmeleri gerekir.\n\nOnaylıyor musunuz?`))) return;
    mutate((d) => {
      d.settings.scoringStandard = std;
      d.scoring.severity = structuredClone(tables.severity);
      d.scoring.occurrence = structuredClone(tables.occurrence);
      d.scoring.detection = structuredClone(tables.detection);
    }, { kind: 'Modified', table: 'settings', id: 'scoringStandard', field: 'scoringStandard', from: p.settings.scoringStandard, to: std, comment: 'Puanlama standardı ve S/O/D kriter tabloları değiştirildi' });
  };
  const apSection = (
      <section className="card">
        <h3>Action Priority (AP) tablosu {custom ? <span className="badge b-purple">{p.scoring.apName || 'Şirket tablosu'}</span> : <span className="badge b-gray">AIAG-VDA 2019</span>}</h3>
        <p className="muted">Hücreye tıklayarak H/M/L değiştirin. Değişiklik bütün DFMEA/PFMEA satırlarının AP değerini etkiler; kaydetmeden önce etkilenen satırlar gösterilir.</p>
        <div className="row-btns">
          <label>
            Tablo adı{' '}
            <input className="cell-input" style={{ width: 220 }} defaultValue={p.scoring.apName ?? ''} placeholder="ör. Şirket AP Rev 2" onBlur={(e) => { const v = e.target.value; if (v !== (p.scoring.apName ?? '')) mutate((d) => { d.scoring.apName = v; }, { kind: 'Modified', table: 'scoring', id: 'apName', field: 'apName', to: v }); }} />
          </label>
          {custom && <button className="btn" onClick={() => setTable(null, 'AP tablosunu AIAG-VDA 2019’a döndür')}>AIAG-VDA’ya döndür</button>}
        </div>
        <table className="ap-table">
          <thead>
            <tr><th>S</th><th>O</th>{D_BANDS.map((d) => <th key={d}>D {d}</th>)}</tr>
          </thead>
          <tbody>
            {[5, 4, 3, 2, 1].flatMap((sb) =>
              [5, 4, 3, 2, 1].map((ob) => {
                const key = `${sb},${ob}`;
                const row = /^[HML]{4}$/.test(table[key] ?? '') ? table[key] : AIAG_VDA_AP[key];
                return (
                  <tr key={key}>
                    {ob === 5 && <td rowSpan={5} className="band">{S_BANDS[sb - 1]}</td>}
                    <td className="band">{O_BANDS[ob - 1]}</td>
                    {[0, 1, 2, 3].map((di) => {
                      const v = row[di];
                      const next = LEVELS[(LEVELS.indexOf(v as 'H') + 1) % 3];
                      const differs = custom && AIAG_VDA_AP[key][di] !== v;
                      return (
                        <td key={di} className={`ap ap-${v} click ${differs ? 'changed' : ''}`} title={differs ? `AIAG-VDA: ${AIAG_VDA_AP[key][di]}` : 'Değiştirmek için tıklayın'} onClick={() => setCell(key, di, next)}>
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </section>
  );
  return (
    <div className="page">
      <section className="card">
        <h3>Puanlama standardı</h3>
        <div className="row-btns">
          <label className="check-row"><input type="radio" checked={scmh} onChange={() => setStandard('SCMH')} /> <b>IAQG SCMH</b> (DFMEA 7.2.10 / PFMEA 7.2.11 D/P-SEV, OCC, DET tabloları)</label>
          <label className="check-row"><input type="radio" checked={!scmh} onChange={() => setStandard('AIAG-VDA')} /> <b>AIAG-VDA 2019</b> (Action Priority)</label>
        </div>
        <TableFormatSetting />
        {scmh
          ? <div className="callout">SCMH kuralı: RPN eşiği yoktur. S 9–10 olan her satır RPN’den bağımsız incelenir; ardından RPN ve S×O’ya göre önceliklendirilir.</div>
          : <div className="callout warn"><b>{RPN_WARNING}</b> Öncelik: emniyet/regülasyon → yüksek severity → KC → AP → RPN.</div>}
      </section>
      {scmh && <ScmhPriorityPanel />}{/* v4-risk: RPN / S×O / S×D sıralaması, Top-N, çıktı seçenekleri */}
      {scmh ? <details className="card"><summary><b>AIAG-VDA Action Priority tablosu (yalnızca referans)</b></summary>{apSection}</details> : apSection}
      <ScoringTab />
    </div>
  );
}

// ───────────────────────── KC faktör paneli ─────────────────────────

export function KcFactorPanel({ id }: { id?: string }) {
  const { project: p } = useStore();
  const kc = p.kcs.find((k) => k.id === id);
  const src = kc ? [...p.dfmea, ...p.pfmea].find((r) => r.id === kc.sourceId) : undefined;
  if (!kc) return <aside className="card tree"><h3>KC değerlendirmesi</h3><p className="muted">Faktörleri görmek için bir KC seçin.</p></aside>;
  if (!src) return <aside className="card tree"><h3>{kc.id}</h3><p className="muted">Kaynak FMEA satırı bağlı değil; faktörler değerlendirilemez.</p></aside>;
  const ev = evaluateKc(p, src, kc);
  return (
    <aside className="card tree">
      <h3>{kc.id} · faktörler</h3>
      <ul className="checks">
        {ev.factors.filter((f) => f.enabled).map((f) => (
          <li key={f.key} className={f.on ? 'bad' : 'ok'}>
            <span className="mark">{f.on ? '!' : '–'}</span>
            <div><b>{f.label}</b><div className="muted small">{f.reason}</div></div>
          </li>
        ))}
      </ul>
      <p className="small"><b>Öneri:</b> {ev.suggestedCategory || 'öneri yok'} <span className="badge b-amber">AI SUGGESTION</span></p>
      <p className="muted small">{ev.summary}</p>
      <p className="muted small">KC kararı ve kategorisi mühendisindir. Yüksek severity tek başına KC kararı değildir.</p>
    </aside>
  );
}

// ───────────────────────── Capability analiz paneli ─────────────────────────

// v4-cap: panel Cap.tsx'e taşındı (AS9145 Tablo 1 bandı, SPC, PPM, veri kaynağı)
export { CapabilityPanel } from './Cap';

// ───────────────────────── Bilgi tabanı ─────────────────────────

export function KbScreen() {
  const { project: p } = useStore();
  const [q, setQ] = useState('');
  const hits = q.trim() ? searchLessons(p, q) : [];
  return (
    <div className="page">
      <section className="card">
        <h3>Ders arama (benzerlik)</h3>
        <input className="cell-input" placeholder="Hata modu, neden veya proses yazın…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim() && !hits.length && <p className="muted">Benzer ders bulunamadı.</p>}
        <table className="effects">
          <tbody>
            {hits.map((h) => (
              <tr key={h.item.id}>
                <td className="rid">{h.item.id}</td>
                <td>{rowLabel(p, h.item.id)}</td>
                <td className="nowrap">%{Math.round(h.score * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>Kompozit bilgi tabanı <span className="badge b-blue">ENGINEERING KNOWLEDGE</span></h3>
        <p className="muted">Genel mühendislik bilgisidir; projeye özgü değer veya limit içermez. Kullanırken kaynak dokümanla doğrulayın.</p>
        <div className="kb-grid">
          {COMPOSITE_KB.map((k) => (
            <div key={k.area} className="kb">
              <h4>{k.area}</h4>
              <p><b>Hata modları:</b> {k.failureModes.join(', ')}</p>
              <p><b>Nedenler:</b> {k.causes.join(', ')}</p>
              <p><b>Önleme:</b> {k.prevention.join(', ')}</p>
              <p><b>Tespit:</b> {k.detection.join(', ')}</p>
              <p><b>Parametreler:</b> {k.parameters.join(', ')}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ───────────────────────── Değişiklik etkisi ─────────────────────────

export function ImpactScreen() {
  const { project: p, edit } = useStore();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const pool = useMemo(() => {
    const all: AnyRow[] = [...p.documents, ...p.requirements, ...p.structure, ...p.dfmea, ...p.processSteps, ...p.processParams, ...p.pfmea, ...p.kcs, ...p.controlPlan];
    const n = q.trim().toLocaleLowerCase('tr');
    return (n ? all.filter((r) => `${r.id} ${rowLabel(p, r.id)}`.toLocaleLowerCase('tr').includes(n)) : all).slice(0, 60);
  }, [p, q]);
  const imp = useMemo(() => (picked.length ? impactOf(p, picked) : null), [p, picked]);
  const reassess = [...p.requirements, ...p.dfmea, ...p.pfmea, ...p.processSteps, ...p.structure, ...p.controlPlan].filter((r) => r.reassess);
  const createCr = async () => {
    if (!imp) return;
    const id = nextId(p, 'changeRequests');
    await edit({ kind: 'add', table: 'changeRequests', row: { id, title: `Değişiklik: ${picked.join(', ')}`, trigger: picked.join(', '), description: '', impactedIds: imp.ids, status: 'Open', requestedBy: p.settings.userName, date: today(), decision: '', origin: 'manual' } as AnyRow }, 'Değişiklik talebi');
  };
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Değişecek kayıtları seçin</h3>
          <input className="cell-input" placeholder="ID veya metin ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pick-list">
            {pool.map((r) => (
              <label key={r.id} className="check-row">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                <span className="rid">{r.id}</span> <span className="small">{rowLabel(p, r.id).replace(`${r.id} `, '').slice(0, 90)}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Etki</h3>
          {!imp && <p className="muted">Kayıt seçildiğinde bağlı zincir burada görünür.</p>}
          {imp && (
            <>
              <div className={`callout ${imp.ids.length ? 'warn' : ''}`}><b>Bu değişiklik {imp.ids.length} mühendislik kaydını etkiliyor.</b></div>
              <table className="effects">
                <tbody>
                  {Object.entries(imp.byTable).map(([t, ids]) => (
                    <tr key={t}>
                      <td className="nowrap"><b>{TABLE_LABEL[t as keyof typeof TABLE_LABEL]}</b> ({ids!.length})</td>
                      <td className="small">{ids!.map((id) => <div key={id} title={imp.edges.find((e) => e.to === id)?.via}>{'·'.repeat(imp.depth[id] ?? 1)} {rowLabel(p, id)}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn primary" onClick={createCr}>Değişiklik talebi oluştur</button>
            </>
          )}
        </section>
      </div>
      <section className="card">
        <h3>Yeniden değerlendirme bekleyen kayıtlar ({reassess.length})</h3>
        {reassess.length === 0 ? <p className="ok-text">✓ Yok</p> : (
          <table className="effects">
            <tbody>
              {reassess.map((r) => (
                <tr key={r.id}>
                  <td className="rid">{r.id}</td>
                  <td>{rowLabel(p, r.id)}</td>
                  <td className="small">{r.reassess}</td>
                  <td><button className="btn small" onClick={() => edit({ kind: 'set', table: tableOfId(r.id)!, id: r.id, field: 'reassess', value: '' }, 'Yeniden değerlendirme tamamlandı')}>Değerlendirildi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ───────────────────────── Kalite kontrol ─────────────────────────

export function QualityScreen({ go }: { go: Go }) {
  const { project: p, toast } = useStore();
  const q = useMemo(() => qualityReport(p), [p]);
  const miss = useMemo(() => whatDidIMiss(p), [p]);
  const goId = (id: string) => window.dispatchEvent(new CustomEvent('why', { detail: id }));
  const exportReport = async (format: 'pdf' | 'html') => {
    if (!isDesktop) return toast('Rapor çıktısı masaüstü uygulamasında çalışır.', 'warn');
    const out = await api.exportReport({ html: buildReviewReportHtml(p, { aiReview: lastReview(p) }), format, name: `${p.meta.partNumber || 'FMEA'}_inceleme` });
    if (out) toast('Rapor oluşturuldu');
  };
  return (
    <div className="page">
      <div className="row-btns">
        <button className="btn" onClick={() => exportReport('pdf')}>İnceleme raporu (PDF)</button>
        <button className="btn" onClick={() => exportReport('html')}>İnceleme raporu (HTML)</button>
        <button className="btn" onClick={() => go('aiReview', 'review')}>AI incelemesine git</button>
      </div>
      <div className="two-col">
        <section className="card">
          <div className="score-head">
            <div className={`gauge ${q.score >= 80 ? 'green' : q.score >= 50 ? 'amber' : 'red'}`} style={{ ['--p' as string]: q.score }}><span>{q.score}</span></div>
            <div>
              <h3>{q.label}</h3>
              <p className="muted">{QUALITY_SCORE_NOTE}</p>
            </div>
          </div>
          <div className="dims">
            {q.dimensions.map((d) => (
              <div key={d.key} className="dim">
                <span>{d.label}</span>
                <div className="bar"><i style={{ width: `${d.applicable ? d.score : 0}%` }} /></div>
                <b>{d.applicable ? d.score : '—'}</b>
                <div className="muted small wide">{d.detail}</div>
              </div>
            ))}
          </div>
          <h3 className="mt">Level 1 · Yapısal kontroller</h3>
          <ul className="checks">
            {q.level1.map((c) => (
              <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                <span className="mark">{c.ok ? '✓' : '!'}</span>
                <div>
                  <b>{c.question}</b>
                  <div className="muted">{c.detail}</div>
                  {!c.ok && c.ids.length > 0 && <div className="ids">{c.ids.slice(0, 30).map((id) => <button key={id} className="link" onClick={() => goId(id)}>{id}</button>)}{c.ids.length > 30 ? ' …' : ''}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h3>Level 2 · Mühendislik kontrolleri ({q.level2.length})</h3>
          {q.level2.length === 0 && <p className="ok-text">✓ Bulgu yok</p>}
          <table className="effects">
            <tbody>
              {q.level2.slice(0, 300).map((f, i) => (
                <tr key={i}>
                  <td><span className={`badge ${f.kind === 'FMEA LOGIC ERROR' ? 'b-red' : 'b-amber'}`}>{f.kind}</span></td>
                  <td className="rid"><button className="link" onClick={() => goId(f.id)}>{f.id}</button></td>
                  <td className="small">{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt">Neyi kaçırdım? (yerel)</h3>
          {miss.length === 0 && <p className="ok-text">✓ Yerel analizde boşluk bulunmadı</p>}
          <ul className="checks">
            {miss.map((m, i) => (
              <li key={i} className="bad">
                <span className="mark">?</span>
                <div><b>{m.area}</b> – {m.message}<div className="ids">{m.ids.slice(0, 20).join(', ')}{m.ids.length > 20 ? ' …' : ''}</div></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ───────────────────────── AI inceleme ─────────────────────────

// Son AI incelemesi oturum boyunca bellekte tutulur (rapora eklenir); proje dosyasına yazılmaz.
let LAST_REVIEW: { key: string; review: AiReview } | null = null;
function lastReview(p: Project): AiReview | undefined {
  return LAST_REVIEW && LAST_REVIEW.key === (p.meta.fmeaNumber || p.meta.name) ? LAST_REVIEW.review : undefined;
}

export function AiReviewScreen() {
  const { project: p, mutate, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<AiReview | null>(() => lastReview(p) ?? null);
  const [cat, setCat] = useState<string>('');
  const run = async () => {
    if (!isDesktop) return toast('AI incelemesi masaüstü uygulamasında çalışır.', 'warn');
    const s = await api.aiStatus();
    if (!s.online) return toast(AI_ERROR_TEXT.OFFLINE, 'warn');
    if (!s.configured && s.provider !== 'local') {
      window.dispatchEvent(new CustomEvent('open-settings'));
      return toast('Önce Ayarlar › AI bölümünden API anahtarını girin.', 'warn');
    }
    const q = qualityReport(p);
    const local = [
      ...q.level1.filter((c) => !c.ok).map((c) => `L1 ${c.question}: ${c.detail} ${c.ids.slice(0, 15).join(',')}`),
      ...q.level2.slice(0, 120).map((f) => `L2 ${f.kind} ${f.id}: ${f.message}`),
      ...whatDidIMiss(p).map((m) => `MISS ${m.area}: ${m.message} ${m.ids.slice(0, 10).join(',')}`),
    ].join('\n');
    setBusy(true);
    const r = await api.aiReview({ context: projectContext(p), local, mode: p.settings.aiMode });
    setBusy(false);
    if (!r.ok) {
      toast(`${r.error.kind}: ${r.error.message}`, 'err');
      mutate((d) => {
        d.aiRuns.push(failedRunEdit(d, 'FMEA Reviewer', 'Proje incelemesi', r.error.kind, r.error.message, r.meta).row as never);
      });
      return;
    }
    const data = r.data as unknown as AiReview;
    setReview(data);
    LAST_REVIEW = { key: p.meta.fmeaNumber || p.meta.name, review: data };
    mutate((d) => {
      const id = nextId(d, 'aiRuns');
      d.aiRuns.push({ id, role: r.meta.role, provider: r.meta.provider, model: r.meta.model, at: r.meta.at, inputs: 'Proje incelemesi', mode: r.meta.mode, status: 'ok', errorKind: '', message: `${data.findings.length} bulgu, ${data.missed.length} eksik`, items: data.findings.length + data.missed.length, accepted: 0, rejected: 0, tokensIn: r.meta.tokensIn, tokensOut: r.meta.tokensOut, cached: r.meta.cached, origin: 'ai' } as never);
    }, { kind: 'AI', table: 'aiRuns', id: 'review', comment: 'AI Review çalıştırıldı (öneri; onay değildir)' });
  };
  const findings = review ? review.findings.filter((f) => !cat || f.category === cat) : [];
  return (
    <div className="page">
      <div className="callout">AI denetçi bağımsız bir inceleme yapar. Bulgular öneridir; hiçbir kaydı değiştirmez veya onaylamaz. Karar mühendisindir.</div>
      <div className="row-btns">
        <button className="btn ai" disabled={busy} onClick={run}>{busy ? 'İnceleniyor…' : '✦ AI incelemesi çalıştır'}</button>
        {review && (
          <select className="cell-select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Tüm kategoriler</option>
            {REVIEW_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
      </div>
      {review && (
        <div className="two-col">
          <section className="card">
            <h3>Bulgular ({findings.length}) <span className="badge b-amber">AI SUGGESTION</span></h3>
            <p className="small">{review.summary}</p>
            <table className="effects">
              <tbody>
                {findings.map((f, i) => (
                  <tr key={i}>
                    <td><span className={`badge ${f.severity === 'Critical' ? 'b-red' : f.severity === 'Major' ? 'b-amber' : 'b-gray'}`}>{f.severity}</span><div className="small muted">{f.category}</div></td>
                    <td>
                      <b>{f.finding}</b>
                      <div className="small">{f.recommendation}</div>
                      <div className="small muted">{f.ids.join(', ')} · {f.basis} · {f.confidence}{f.confidence === 'Low' ? ` · ${LOW_CONF_TEXT}` : ''}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h3>WHAT DID I MISS? ({review.missed.length})</h3>
            <ul className="checks">
              {review.missed.map((m, i) => (
                <li key={i} className="bad">
                  <span className="mark">?</span>
                  <div><b>{m.area}</b>: {m.item}<div className="small muted">{m.why} · {m.confidence}{m.confidence === 'Low' ? ` · ${LOW_CONF_TEXT}` : ''}</div></div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Onay akışı ─────────────────────────

export function WorkflowScreen() {
  const { project: p, replace, mutate, toast } = useStore();
  const step = currentStep(p);
  const crit = openCriticalAi(p);
  const [comment, setComment] = useState('');
  const decide = (decision: ApprovalRecord['decision']) => {
    if (!step) return;
    const d = { step, decision, user: p.settings.userName, role: p.settings.userRole, comment };
    const err = decisionError(p, d, crit.length);
    if (err) return toast(err, 'warn');
    const next = recordDecision(p, d);
    mutate((draft) => {
      draft.approvals = next.approvals;
    }, { kind: 'Approval', table: 'approvals', id: step, to: decision, comment });
    setComment('');
    toast(`${step}: ${decision}`);
    void replace;
  };
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Onay adımları · {p.meta.fmeaRevision}</h3>
          <ol className="wf">
            {enabledSteps(p).map((s) => {
              const done = approvedSteps(p).has(s.step);
              return <li key={s.step} className={done ? 'done' : s.step === step ? 'cur' : ''}><span className="mark">{done ? '✓' : s.step === step ? '●' : '○'}</span> {s.step} <span className="muted small">{s.role}</span></li>;
            })}
          </ol>
          {!step && <p className="ok-text">✓ Bu revizyonun tüm adımları onaylandı.</p>}
          {step && (
            <>
              <p>Sıradaki adım: <b>{step}</b> · Karar veren: <b>{p.settings.userName || '— (Ayarlar’da kullanıcı adı girin)'}</b> {p.settings.userRole && `(${p.settings.userRole})`}</p>
              {crit.length > 0 && <div className="callout warn">{crit.length} kritik/emniyet/regülasyon kaydı “AI Proposed” durumunda: {crit.slice(0, 15).join(', ')}{crit.length > 15 ? ' …' : ''}. Final onaydan önce tek tek değerlendirilmeli.</div>}
              <textarea className="cell-input" rows={3} placeholder="Yorum (ret / iade için zorunlu)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="row-btns">
                <button className="btn ok" onClick={() => decide('Approved')}>✓ Onayla</button>
                <button className="btn" onClick={() => decide('Returned')}>↩ İade et</button>
                <button className="btn danger" onClick={() => decide('Rejected')}>✕ Reddet</button>
              </div>
              <p className="muted small">AI hiçbir adımı onaylayamaz. Her karar kullanıcı adı, rol, zaman ve yorumla kaydedilir.</p>
            </>
          )}
        </section>
        <section className="card">
          <h3>Karar geçmişi</h3>
          {p.approvals.length === 0 && <p className="muted">Henüz karar yok.</p>}
          <table className="effects">
            <tbody>
              {[...p.approvals].reverse().map((a) => (
                <tr key={a.id}>
                  <td className="nowrap small">{fmtDate(a.at)}<div className="muted">{a.revision}</div></td>
                  <td><b>{a.step}</b> · <span className={`badge ${a.decision === 'Approved' ? 'b-green' : a.decision === 'Rejected' ? 'b-red' : 'b-amber'}`}>{a.decision}</span><div className="small">{a.user} ({a.role || '—'}) {a.comment && `– ${a.comment}`}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

// ───────────────────────── Denetim izi ─────────────────────────

export function AuditScreen() {
  const { project: p } = useStore();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(300);
  const rows = useMemo(() => {
    const n = q.trim().toLocaleLowerCase('tr');
    const all = [...p.auditLog].reverse();
    return n ? all.filter((a) => JSON.stringify(a).toLocaleLowerCase('tr').includes(n)) : all;
  }, [p.auditLog, q]);
  const v = (x: unknown) => (x == null || x === '' ? '—' : Array.isArray(x) ? x.join(', ') : typeof x === 'object' ? JSON.stringify(x) : String(x));
  return (
    <div className="page">
      <section className="card">
        <h3>Denetim izi ({p.auditLog.length})</h3>
        <p className="muted">Her değişiklik kullanıcı, zaman, eski/yeni değer, neden ve yorumla kaydedilir. Kayıtlar düzenlenemez.</p>
        <input className="cell-input" placeholder="Ara (ID, kullanıcı, alan…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <table className="effects audit">
          <thead><tr><th>Zaman</th><th>Kullanıcı</th><th>Tür</th><th>Kayıt</th><th>Alan</th><th>Eski</th><th>Yeni</th><th>Neden / Yorum</th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((a, i) => (
              <tr key={i}>
                <td className="nowrap small">{fmtDate(a.at)}</td>
                <td className="small">{a.user || '—'}</td>
                <td><span className="badge b-gray">{a.kind}</span></td>
                <td className="rid">{a.id}</td>
                <td className="small">{a.field ?? ''}</td>
                <td className="small">{v(a.from)}</td>
                <td className="small">{v(a.to)}</td>
                <td className="small">{[a.reason, a.comment].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > limit && <button className="link more" onClick={() => setLimit(limit + 300)}>Devamını göster ({rows.length - limit})</button>}
      </section>
    </div>
  );
}

// ───────────────────────── Baseline ─────────────────────────

export function BaselinesScreen() {
  const { project: p, mutate, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ approver: '', approvalComment: '', changeReason: '' });
  const [cmp, setCmp] = useState<{ a: string; b: string }>({ a: '', b: 'current' });
  const finalOk = approvedSteps(p).has('Final Approval') || !enabledSteps(p).some((s) => s.step === 'Final Approval');
  const create = () => {
    if (!p.settings.userName) return toast('Önce Ayarlar’da kullanıcı adı girin.', 'warn');
    if (!form.changeReason.trim()) return toast('Değişiklik nedeni zorunludur.', 'warn');
    const b = createBaseline(p, { revision: p.meta.fmeaRevision, author: p.settings.userName, ...form });
    mutate((d) => {
      d.baselines = appendBaseline(d, b).baselines;
    }, { kind: 'Baseline', table: 'baselines', id: b.id, to: b.hash.slice(0, 12), comment: form.changeReason });
    setOpen(false);
    toast(`${b.id} oluşturuldu ve mühürlendi`);
  };
  const diff: RowDiff[] | null = useMemo(() => {
    if (!cmp.a) return null;
    const get = (k: string) => (k === 'current' ? p : baselineProject(p.baselines.find((b) => b.id === k)!));
    try {
      return diffProjects(get(cmp.a), get(cmp.b));
    } catch {
      return null;
    }
  }, [cmp, p]);
  return (
    <div className="page">
      <section className="card">
        <h3>Baselines</h3>
        <p className="muted">Baseline, projenin değiştirilemez bir anlık görüntüsüdür (SHA-256 mühürlü). Mühür bozulursa dosya açılırken uyarı verilir.</p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => setOpen(true)}>Baseline oluştur</button>
          {!finalOk && <span className="badge b-amber">Final onay verilmeden oluşturulan baseline “onaysız” olarak işaretlenir</span>}
        </div>
        <table className="effects">
          <thead><tr><th>ID</th><th>Revizyon</th><th>Tarih</th><th>Hazırlayan</th><th>Onaylayan</th><th>Neden</th><th>Mühür</th></tr></thead>
          <tbody>
            {p.baselines.map((b) => (
              <tr key={b.id}>
                <td className="rid">{b.id}</td><td>{b.revision}</td><td className="small">{fmtDate(b.date)}</td><td>{b.author}</td><td>{b.approver || '—'}</td><td className="small">{b.changeReason}</td>
                <td>{verifyBaseline(b) ? <span className="badge b-green" title={b.hash}>✓ {b.hash.slice(0, 10)}</span> : <span className="badge b-red">MÜHÜR BOZUK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {p.baselines.length > 0 && (
        <section className="card">
          <h3>Karşılaştır</h3>
          <div className="row-btns">
            <select className="cell-select" value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: e.target.value })}>
              <option value="">Baseline seç…</option>
              {p.baselines.map((b) => <option key={b.id} value={b.id}>{b.id} {b.revision}</option>)}
            </select>
            →
            <select className="cell-select" value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: e.target.value })}>
              <option value="current">Güncel proje</option>
              {p.baselines.map((b) => <option key={b.id} value={b.id}>{b.id} {b.revision}</option>)}
            </select>
          </div>
          {diff && (
            <>
              <p><b>{diffSummary(diff)}</b></p>
              <table className="effects">
                <tbody>
                  {diff.slice(0, 400).map((d) => (
                    <tr key={`${d.table}-${d.id}`}>
                      <td><span className={`badge ${d.kind === 'Added' ? 'b-green' : d.kind === 'Deleted' ? 'b-red' : 'b-amber'}`}>{d.kind}</span></td>
                      <td className="rid">{d.id}</td>
                      <td className="small">{d.fields.slice(0, 6).map((f) => `${f.field}: ${JSON.stringify(f.from ?? '')} → ${JSON.stringify(f.to ?? '')}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
      {open && (
        <Modal title="Baseline oluştur" sub={`${p.meta.fmeaRevision} · ${p.settings.userName || 'kullanıcı adı yok'}`} onClose={() => setOpen(false)}
          foot={<><button className="btn" onClick={() => setOpen(false)}>Vazgeç</button><button className="btn primary" onClick={create}>Oluştur ve mühürle</button></>}>
          <div className="form">
            <label><span>Onaylayan</span><input className="cell-input" value={form.approver} onChange={(e) => setForm({ ...form, approver: e.target.value })} /></label>
            <label className="wide"><span>Onay yorumu</span><input className="cell-input" value={form.approvalComment} onChange={(e) => setForm({ ...form, approvalComment: e.target.value })} /></label>
            <label className="wide"><span>Değişiklik nedeni (zorunlu)</span><textarea className="cell-input" rows={3} value={form.changeReason} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} /></label>
          </div>
          {!finalOk && <div className="callout warn">Final onay adımı tamamlanmadı. Baseline yine oluşturulabilir; kayıtta onaylayan alanı boş bırakılırsa onaysız kabul edilir.</div>}
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── Kanıtlar ─────────────────────────

export function EvidenceScreen() {
  const { project: p, edit } = useStore();
  const verifyAll = async () => {
    const edits = p.evidence.flatMap((e: EvidenceRow) => {
      const doc = p.docIndex[e.docId];
      const c = verifySource(doc, e.quote, { page: e.page ? Number(e.page) || undefined : undefined, section: e.section || undefined, sheet: e.sheet || undefined, cell: e.cell || undefined });
      const loc = c.foundAt ? Object.entries(c.foundAt).map(([k, v]) => `${k} ${v}`).join(', ') : '';
      return c.verdict === e.verification && loc === e.verifiedLocation ? [] : [
        { kind: 'set' as const, table: 'evidence' as const, id: e.id, field: 'verification', value: c.verdict },
        { kind: 'set' as const, table: 'evidence' as const, id: e.id, field: 'verifiedLocation', value: loc },
      ];
    });
    if (edits.length) await edit(edits, 'Kaynak doğrulama');
  };
  return (
    <Grid
      table="evidence"
      toolbar={<button className="btn" onClick={verifyAll} title="Her kanıt alıntısını analiz edilmiş dokümanda arar">Kaynakları doğrula</button>}
      emptyHint="AI önerileri kabul edildiğinde kanıtlar (doküman, sayfa/bölüm/hücre, birebir alıntı) burada tutulur. Kaynakta bulunamayan alıntı SOURCE NOT VERIFIED olur."
    />
  );
}

// ───────────────────────── Ayarlar ─────────────────────────

const KC_RULE_LABEL: Record<keyof KcRules, string> = {
  safety: 'Emniyet etkisi', regulatory: 'Regülasyon', customer: 'Müşteri tanımlı', specialProcess: 'Özel proses', tolerance: 'Dar tolerans',
  capability: 'Düşük capability', historical: 'Geçmiş uygunsuzluk', detection: 'Zayıf tespit',
} as Record<keyof KcRules, string>;

export function SettingsScreen() {
  const { project: p, edit, mutate, toast, ask } = useStore();
  const s = p.settings;
  const set = (field: keyof Settings, value: unknown, title = 'Ayar değişikliği') => edit({ kind: 'settings', field, value }, title);
  const [ai, setAi] = useState<Awaited<ReturnType<typeof api.aiStatus>> | null>(null);
  const [key, setKey] = useState('');
  const [ifs, setIfs] = useState<Record<string, unknown> | null>(null);
  const [tplErr, setTplErr] = useState<string[]>([]);
  const [pendingTpl, setPendingTpl] = useState<CompanyTemplate | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    api.aiStatus().then(setAi);
    api.ifsGet().then(setIfs);
  }, []);
  const saveKey = async (k: string) => {
    const r = await api.aiSetKey(k.trim());
    setAi(await api.aiStatus());
    setKey('');
    toast(r.stored === 'secure' ? 'API anahtarı işletim sistemi şifrelemesiyle kaydedildi' : r.stored === 'session' ? 'Güvenli depolama yok: anahtar yalnızca bu oturum için bellekte tutuluyor' : 'API anahtarı silindi', r.stored === 'session' ? 'warn' : 'ok');
  };
  const saveTemplate = async () => {
    const name = await ask({ title: 'Şablon adı', input: p.meta.customer ? `${p.meta.customer} FMEA şablonu` : 'Şirket FMEA şablonu' });
    if (!name) return;
    const out = await api.saveTemplate(makeTemplate(p, name));
    if (out) toast('Şirket şablonu kaydedildi');
  };
  const openTemplate = async () => {
    const t = await api.openTemplate();
    if (!t) return;
    const errs = validateTemplate(t);
    setTplErr(errs);
    if (errs.length) return toast('Şablon geçersiz', 'err');
    setPendingTpl(t as CompanyTemplate);
  };
  const confirmTemplate = () => {
    if (!pendingTpl) return;
            mutate((d) => {
              const n = applyTemplate(d, pendingTpl);
              d.settings = n.settings;
              d.scoring = n.scoring;
            }, { kind: 'Modified', table: 'settings', id: 'template', to: pendingTpl.name, comment: 'Şirket şablonu uygulandı' });
    setPendingTpl(null);
    toast(`“${pendingTpl.name}” uygulandı`);
  };
  const setIfsField = async (k: string, v: unknown) => setIfs(await api.ifsSet({ ...(ifs ?? {}), [k]: v }));

  return (
    <div className="page">
      <section className="card">
        <TableFormatSetting first />
      </section>
      <div className="two-col">
        <section className="card">
          <h3>Kullanıcı</h3>
          <p className="muted">Onaylar, denetim izi ve baseline kayıtları bu adla tutulur.</p>
          <div className="form">
            <label><span>Ad Soyad</span><input className="cell-input" defaultValue={s.userName} onBlur={(e) => e.target.value !== s.userName && set('userName', e.target.value, 'Kullanıcı adı')} /></label>
            <label>
              <span>Rol</span>
              <select className="cell-select" value={s.userRole} onChange={(e) => set('userRole', e.target.value, 'Kullanıcı rolü')}>
                <option value="">—</option>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <h3 className="mt">AI</h3>
          {!isDesktop && <p className="muted">AI ayarları masaüstü uygulamasında kullanılabilir.</p>}
          {isDesktop && ai && (
            <>
              <p className="small">
                {!ai.online ? AI_ERROR_TEXT.OFFLINE : ai.configured ? (ai.fromEnv ? `✓ ${ai.envVar} ortam değişkeninden` : ai.sessionOnly ? '✓ Anahtar yalnızca bu oturum için bellekte' : '✓ Anahtar güvenli depolamada') : '✕ Anahtar yok – AI özellikleri kapalı'}
              </p>
              <div className="form">
                <label>
                  <span>Sağlayıcı</span>
                  <select className="cell-select" value={ai.provider} onChange={async (e) => { await api.aiSetProvider(e.target.value); setAi(await api.aiStatus()); }}>
                    {ai.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.supported ? '' : ' (NOT SUPPORTED)'}</option>)}
                  </select>
                </label>
                <label>
                  <span>Çalışma modu</span>
                  <select className="cell-select" value={s.aiMode} onChange={(e) => set('aiMode', e.target.value, 'AI modu')}>
                    <option value="strict">Strict Engineering (yalnızca kaynak)</option>
                    <option value="knowledge">Engineering Knowledge (bilgi ayrı etiketli)</option>
                  </select>
                </label>
                {ai.provider === 'anthropic' && (
                  <label><span>Claude modeli</span><select className="cell-select" value={ai.model} onChange={async (e) => { await api.aiSetModel(e.target.value); setAi(await api.aiStatus()); }}>{(ai.anthropicModels ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
                )}
                {ai.provider === 'openai' && (
                  <label><span>Model</span><input className="cell-input" key={ai.model} defaultValue={ai.model} placeholder="gpt-5" onBlur={async (e) => { if (e.target.value.trim() !== ai.model) { await api.aiSetModel(e.target.value); setAi(await api.aiStatus()); } }} /></label>
                )}
                <label className="wide"><span>API anahtarı ({ai.providers.find((x) => x.id === ai.provider)?.label ?? ai.provider})</span><input className="cell-input" type="password" placeholder={ai.provider === 'openai' ? 'sk-…' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} /></label>
              </div>
              {!ai.secureStorage && <div className="callout warn">Bu sistemde işletim sistemi şifrelemesi yok. Anahtar diske yazılmaz; uygulama kapanınca silinir.</div>}
              <div className="row-btns">
                <button className="btn primary" disabled={!key.trim()} onClick={() => saveKey(key)}>Kaydet</button>
                {ai.configured && !ai.fromEnv && <button className="btn danger" onClick={() => saveKey('')}>Anahtarı sil</button>}
                <button className="btn" onClick={async () => { await api.aiClearCache(); toast('AI önbelleği temizlendi'); }}>Önbelleği temizle</button>
              </div>
            </>
          )}
          <div className="callout">AI önerileri doküman ve proje verisini seçili sağlayıcıya gönderir. AI hiçbir FMEA, KC, S/O/D, kontrol veya mühendislik değişikliğini onaylamaz.</div>
          <ExampleLibrary />

          <h3 className="mt">Şirket şablonu</h3>
          <p className="muted">Ayarlar, KC kuralları, onay akışı ve puanlama/AP tablosu tek dosyada (.fmeatpl). Şablon satırlara dokunmaz.</p>
          <div className="row-btns">
            <button className="btn" onClick={saveTemplate} disabled={!isDesktop}>Şablon olarak kaydet</button>
            <button className="btn" onClick={openTemplate} disabled={!isDesktop}>Şablon uygula…</button>
          </div>
          {tplErr.length > 0 && <ul className="plain small warn-text">{tplErr.map((e) => <li key={e}>{e}</li>)}</ul>}
        </section>

        <section className="card">
          <ScmhDirSetting />
          <h3 className="mt">KC kuralları</h3>
          <div className="form">
            <label>
              <span>KC Severity eşiği</span>
              <select className="cell-select" value={s.kcSeverityThreshold} onChange={(e) => set('kcSeverityThreshold', Number(e.target.value))}>
                {[10, 9, 8, 7, 6, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {(Object.keys(KC_RULE_LABEL) as (keyof KcRules)[]).filter((k) => k in s.kcRules).map((k) => (
              <label key={k} className="check-row">
                <input type="checkbox" checked={!!s.kcRules[k]} onChange={(e) => set('kcRules', { ...s.kcRules, [k]: e.target.checked }, 'KC kuralı')} />
                <span>{KC_RULE_LABEL[k]}</span>
              </label>
            ))}
            <label className="wide">
              <span>KC sınıfları (virgülle)</span>
              <input className="cell-input" defaultValue={s.kcClasses.join(', ')} onBlur={(e) => set('kcClasses', e.target.value.split(',').map((x) => x.trim()).filter(Boolean), 'KC sınıfları')} />
            </label>
          </div>

          <h3 className="mt">Onay akışı</h3>
          <table className="effects">
            <tbody>
              {s.workflow.map((w, i) => (
                <tr key={w.step}>
                  <td><input type="checkbox" checked={w.enabled} disabled={w.step === 'AI Draft'} onChange={(e) => set('workflow', s.workflow.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)), 'Onay akışı')} /></td>
                  <td>{w.step}</td>
                  <td>
                    <select className="cell-select" value={w.role} onChange={(e) => set('workflow', s.workflow.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)), 'Onay rolü')}>
                      <option value="">—</option>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.workflow.length !== WORKFLOW_STEPS.length && <button className="link" onClick={() => set('workflow', DEFAULT_SETTINGS.workflow, 'Onay akışı')}>Varsayılana döndür</button>}

          <h3 className="mt">Neden zorunlu alanlar</h3>
          <p className="muted small">Bu alanlar değişirken değişiklik nedeni sorulur (ör. s, o, d, approval, kcs.status).</p>
          <input className="cell-input" defaultValue={s.reasonFields.join(', ')} onBlur={(e) => set('reasonFields', e.target.value.split(',').map((x) => x.trim()).filter(Boolean), 'Neden alanları')} />

          <h3 className="mt">Neden görünümü</h3>
          <select className="cell-select" value={s.causeView} onChange={(e) => set('causeView', e.target.value, 'Neden görünümü')}>
            <option value="4M">4M (Man, Machine, Material, Method)</option>
            <option value="5M+E">5M + Environment</option>
          </select>

          <h3 className="mt">IFS bağlantısı (opsiyonel)</h3>
          <p className="muted small">IFS kapalıyken bütün FMEA Studio işlevleri çalışır. Canlı bağlantı bu sürümde NOT SUPPORTED; mock mod örnek veri döndürür (MOCK etiketli).</p>
          {isDesktop && ifs && (
            <div className="form">
              <label className="check-row"><input type="checkbox" checked={!!ifs.enabled} onChange={(e) => setIfsField('enabled', e.target.checked)} /><span>IFS modülünü etkinleştir</span></label>
              <label>
                <span>Mod</span>
                <select className="cell-select" value={String(ifs.mode ?? 'mock')} onChange={(e) => setIfsField('mode', e.target.value)}>
                  <option value="mock">Mock (test verisi)</option>
                  <option value="live">Live (NOT SUPPORTED)</option>
                </select>
              </label>
              <button className="btn" disabled={!ifs.enabled} onClick={async () => { const r = await api.ifsTest(); toast(r.ok ? r.data.message : r.error, r.ok && r.data.ok ? 'ok' : 'warn'); }}>Bağlantıyı test et</button>
            </div>
          )}
        </section>
      </div>
      {pendingTpl && (
        <Modal title={`Şablon uygula: ${pendingTpl.name}`} sub="Ayarlar, KC kuralları, onay akışı ve puanlama/AP tablosu değişir. Satırlar değişmez; kullanıcı adı ve rolü korunur." onClose={() => setPendingTpl(null)}
          foot={<><button className="btn" onClick={() => setPendingTpl(null)}>Vazgeç</button><button className="btn primary" onClick={confirmTemplate}>Uygula</button></>}>
          <p className="small">Değişecek ayarlar: {Object.keys(pendingTpl.settings).join(', ')}. AP tablosu: {pendingTpl.scoring.apTable ? pendingTpl.scoring.apName || 'şirket tablosu' : 'AIAG-VDA 2019'}.</p>
          <p className="muted small">Mevcut S/O/D puanları değişmez; AP değerleri yeni tabloya göre yeniden hesaplanır.</p>
        </Modal>
      )}
    </div>
  );
}

function ScmhDirSetting() {
  const [st, setSt] = useState<{ dir: string; missing: string[] } | null>(null);
  useEffect(() => {
    if (isDesktop) api.scmhGetDir().then(setSt);
  }, []);
  if (!isDesktop) return null;
  return (
    <>
      <h3>IAQG SCMH şablonları</h3>
      <p className="muted small">SCMH paketi resmi IAQG şablonlarına doldurulur (PFD 7.2.9, DFMEA 7.2.10, PFMEA 7.2.11, Kontrol Planı 7.2.13). Şablonlar © IAQG olduğu için uygulamayla dağıtılmaz; scmh.iaqg.org’dan indirip bir klasöre koyun.</p>
      <p className="small">{st?.dir ? <>Klasör: <b>{st.dir}</b></> : 'Klasör seçilmedi.'} {st && st.missing.length > 0 && <span className="warn-text">Eksik: {st.missing.join(', ')}</span>}{st?.dir && st.missing.length === 0 && <span className="ok-text"> ✓ 4 şablon bulundu</span>}</p>
      <button className="btn" onClick={async () => { const r = await api.scmhPickDir(); if (r) setSt(r); }}>Klasör seç…</button>
    </>
  );
}

/** 4.5.0: onaylı satır örnek kütüphanesi (bu bilgisayarda). Proje kaydedilince Approved / Engineer Reviewed satırlar eklenir. */
function ExampleLibrary() {
  const { toast } = useStore();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (isDesktop) void api.examplesInfo().then((x) => setCount(x.count));
  }, []);
  if (!isDesktop) return null;
  return (
    <>
      <h3 className="mt">AI örnek kütüphanesi</h3>
      <p className="muted">
        Onayladığınız (Approved / Engineer Reviewed) DFMEA ve PFMEA satırları proje kaydedilince bu bilgisayardaki kütüphaneye eklenir. AI önerisinde hedefe en benzer 8 örnek “şirket tarzı” referansı olarak
        gönderilir; AI örnekleri kopyalamaz, sayısal değer almaz. Kütüphanede {count ?? '…'} satır var.
      </p>
      <div className="row-btns">
        <button className="btn" disabled={!count} onClick={async () => { await api.examplesClear(); setCount(0); toast('Örnek kütüphanesi temizlendi'); }}>Kütüphaneyi temizle</button>
      </div>
    </>
  );
}
