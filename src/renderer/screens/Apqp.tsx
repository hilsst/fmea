// v4-apqp: APQP ve PPAP ekranları. Tüm kararlar (gereklilik, kontrol cevapları, onaylar, PPAP kararı) kullanıcı
// adıyla mühendis tarafından verilir ve denetim izine yazılır. Uygulama yalnızca öneri ve kontrol gösterir.
import { useMemo, useState, type ReactNode } from 'react';
import {
  APQP_CATALOG, APQP_PHASES, APQP_PROJECT_TYPES, APQP_SOURCE_NOTE, CATALOG_BY_KEY, CP_PHASES, DELIVERABLES, DRA_METHODS, KNOWLEDGE_GAPS, MILESTONES, PPAP_ELEMENTS, REQUIRED_FUNCTIONS, TEAM_FUNCTIONS,
  applicabilityOf, cpPromotionCandidates, criteriaAgreed, deliverableApproved, deliverableApprovedSteps, deliverableDecisionError, deliverableHasContent, deliverableNextStep, deliverableSteps, dfmeaTiming,
  elementRyg, interimReasonSuggestion, isUpdateTrigger, latestSubmission, maturityEvidence, milestoneStatus, mitigatedOpenActions, packagingApprovalError, packagingApproved, packagingIssues,
  packagingPfmeaDrafts, phaseRyg, ppapReadiness, ppapResubmission, prrBlockers, prrDecisionError, recordDeliverableDecision, reuseRows, shipmentAllowed, submissionError, suggest, teamGaps, teamText,
  type ApqpData, type ApqpElement, type Deliverable, type PpapSubmission, type Ryg,
} from '../../shared/apqp';
import { blankRow, nextId } from '../../shared/model';
import type { ScreenKey } from '../../shared/nav';
import type { AnyRow, AuditEntry, Project } from '../../shared/types';
import { api, isDesktop } from '../api';
import { TextCell } from '../components/Cells';
import { Modal } from '../components/Modal';
import { useStore } from '../store';

type Go = (screen: ScreenKey, sub?: string) => void;
const fmtDate = (s: string) => (s ? new Date(s).toLocaleString('tr-TR') : '');
const RYG_CLS: Record<Ryg, string> = { Green: 'b-green', Yellow: 'b-amber', Red: 'b-red', '': 'b-gray' };
const RygBadge = ({ r, title }: { r: Ryg; title?: string }) => <span className={`badge ${RYG_CLS[r]}`} title={title}>{r || '—'}</span>;

/** Gezinme rozeti. */
export function apqpBadge(p: Project, key: 'apqp' | 'ppap'): { n: number | string; tone?: string } | null {
  if (!p.apqp?.projectType) return null;
  if (key === 'apqp') {
    const red = p.apqp.elements.filter((e) => elementRyg(e).ryg === 'Red').length;
    return red ? { n: `${red} Red`, tone: 'red' } : { n: p.apqp.projectType };
  }
  const s = latestSubmission(p);
  if (ppapResubmission(p).required) return { n: 'Yeniden sun', tone: 'amber' };
  return s ? { n: s.disposition || '—', tone: s.disposition === 'Full' ? 'green' : s.disposition === 'Rejected' ? 'red' : 'amber' } : null;
}

/** APQP projesinde içeriği olup teslimat onayı tamamlanmamış DFMEA / PFMEA / PFD / KP. */
export function apqpUnapproved(p: Project): string[] {
  if (!p.apqp?.projectType) return [];
  return (['DFMEA', 'PFMEA', 'PFD', 'CP'] as Deliverable[]).filter((d) => deliverableHasContent(p, d) && !deliverableApproved(p, d));
}

function useApqp() {
  const store = useStore();
  const { project: p, mutate } = store;
  const upd = (id: string, field: string, fn: (a: ApqpData, d: Project) => void, to?: unknown, kind: AuditEntry['kind'] = 'Modified', comment?: string) =>
    mutate((d) => fn(d.apqp, d), { kind, table: 'apqp', id, field, to, comment });
  const commit = (id: string, field: string, fn: (a: ApqpData, v: string) => void) => (v: unknown) => {
    upd(id, field, (a) => fn(a, String(v ?? '')), v);
    return Promise.resolve(true);
  };
  return { ...store, p, a: p.apqp, upd, commit, user: p.settings.userName };
}

const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => (
  <label className={wide ? 'wide' : ''}><span>{label}</span>{children}</label>
);

function Select({ value, options, onChange, empty = '—' }: { value: string; options: readonly string[] | { key: string; label: string }[]; onChange: (v: string) => void; empty?: string }) {
  return (
    <select className="cell-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.key} value={o.key}>{o.label}</option>))}
    </select>
  );
}

// ═════════════════════════ APQP ═════════════════════════

export function ApqpScreen({ sub, go }: { sub?: string; go: Go }) {
  switch (sub) {
    case 'phases': return <PhasesTab />;
    case 'approvals': return <ApprovalsTab />;
    case 'team': return <TeamTab />;
    case 'dra': return <DraTab />;
    case 'cp': return <CpTab go={go} />;
    case 'packaging': return <PackagingTab />;
    case 'reuse': return <ReuseTab go={go} />;
    case 'maturity': return <MaturityTab />;
    default: return <ElementsTab />;
  }
}

function ElementsTab() {
  const { p, a, upd, commit } = useApqp();
  const [open, setOpen] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const setEl = (key: string, field: keyof ApqpElement, v: unknown) =>
    upd(key, field, (x) => {
      const e = x.elements.find((e) => e.key === key)!;
      (e as unknown as Record<string, unknown>)[field] = v;
      if (field === 'status' && v === 'Complete' && !e.completedDate) e.completedDate = new Date().toISOString().slice(0, 10);
    }, v);
  const rows = APQP_CATALOG.filter((c) => !phase || c.phase === phase);
  const undecided = APQP_CATALOG.filter((c) => applicabilityOf(c, a.projectType) === 'Mandatory' && !a.elements.find((e) => e.key === c.key)?.required);
  return (
    <div className="page">
      <section className="card">
        <h3>Proje tipi ve sorumlu (7.2.12 / 7.2.15)</h3>
        <div className="form">
          <Field label="APQP proje tipi (7.2.15)">
            <Select value={a.projectType} options={APQP_PROJECT_TYPES} onChange={(v) => upd('projectType', 'projectType', (x) => { x.projectType = v as ApqpData['projectType']; }, v)} empty="— (APQP kullanılmıyor)" />
          </Field>
          <Field label="Proje lideri (7.2.12 Project Lead)"><TextCell value={a.projectLead} onCommit={commit('projectLead', 'projectLead', (x, v) => { x.projectLead = v; })} /></Field>
        </div>
        <p className="muted small">Uygulanabilirlik SCMH 7.2.15 matrisinden gelir: X = Mandatory, O = Recommended, boş = As needed; ★ = 9145 gereksinimi. “Gerekli değil (N)” seçilen her eleman için neden yazılır. {APQP_SOURCE_NOTE}</p>
        {a.projectType && undecided.length > 0 && (
          <div className="callout warn">
            {undecided.length} zorunlu eleman için Y/N kararı yok.{' '}
            <button className="btn" onClick={() => upd('elements', 'required', (x) => { for (const c of undecided) x.elements.find((e) => e.key === c.key)!.required = 'Y'; }, 'Y', 'Modified', 'Zorunlu elemanlar kullanıcı tarafından toplu Y yapıldı')}>Zorunluları “Y” yap</button>
          </div>
        )}
        <div className="row-btns">
          {[0, 1, 2, 3, 4, 5].map((ph) => (
            <button key={ph} className={`chip-btn ${phase === ph ? 'on' : ''}`} onClick={() => setPhase(ph)}>{ph ? APQP_PHASES[ph - 1] : 'Tümü'} {ph > 0 && <RygBadge r={phaseRyg(p, ph)} />}</button>
          ))}
        </div>
        <table className="effects">
          <thead><tr><th>Faz</th><th>ID</th><th>Eleman</th><th>Uygulanabilirlik</th><th>Gerekli</th><th>Gerekli değilse neden</th><th>Onaylayan</th><th>Sorumlu</th><th>Hedef</th><th>Durum</th><th>RYG</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const e = a.elements.find((x) => x.key === c.key)!;
              const ap = applicabilityOf(c, a.projectType);
              const ryg = elementRyg(e);
              return [
                <tr key={c.key} className={open === c.key ? 'sel' : ''}>
                  <td>{c.phase}</td>
                  <td className="rid"><button className="link" onClick={() => setOpen(open === c.key ? null : c.key)} title="Kontrol listesi">{c.matrixId ?? c.key}</button></td>
                  <td>{c.name} <span className="muted small">{c.type === 'Activity' ? 'Faaliyet' : 'Teslimat'}</span>{c.is9145 && <span title="9145 gereksinimi"> ★</span>}</td>
                  <td>{ap && <span className={`badge ${ap === 'Mandatory' ? 'b-red' : ap === 'Recommended' ? 'b-blue' : 'b-gray'}`}>{ap}</span>}</td>
                  <td><Select value={e.required} options={['Y', 'N']} onChange={(v) => setEl(c.key, 'required', v)} /></td>
                  <td><TextCell value={e.reason} onCommit={(v) => { setEl(c.key, 'reason', String(v ?? '')); return Promise.resolve(true); }} /></td>
                  <td><TextCell value={e.approvedBy} onCommit={(v) => { setEl(c.key, 'approvedBy', String(v ?? '')); return Promise.resolve(true); }} /></td>
                  <td><TextCell value={e.assignedTo} onCommit={(v) => { setEl(c.key, 'assignedTo', String(v ?? '')); return Promise.resolve(true); }} /></td>
                  <td><TextCell type="date" value={e.targetDate} onCommit={(v) => { setEl(c.key, 'targetDate', String(v ?? '')); return Promise.resolve(true); }} /></td>
                  <td><Select value={e.status} options={['Not started', 'In work', 'Complete']} onChange={(v) => setEl(c.key, 'status', v)} /></td>
                  <td><RygBadge r={ryg.ryg} title={ryg.why} />{ap === 'Mandatory' && e.required === 'N' && !e.reason.trim() && <div className="small" style={{ color: 'var(--red, #c00)' }}>Neden zorunlu</div>}</td>
                </tr>,
                open === c.key && (
                  <tr key={`${c.key}-cl`}>
                    <td colSpan={11}><Checklist el={e} /></td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Checklist({ el }: { el: ApqpElement }) {
  const { p, upd } = useApqp();
  const [q, setQ] = useState('');
  const setItem = (id: string, field: string, v: string) =>
    upd(el.key, `checklist.${field}`, (x) => {
      const it = x.elements.find((e) => e.key === el.key)!.checklist.find((c) => c.id === id)!;
      (it as unknown as Record<string, string>)[field] = v;
    }, v);
  const setEl = (field: keyof ApqpElement, v: unknown) => upd(el.key, field, (x) => { (x.elements.find((e) => e.key === el.key)! as unknown as Record<string, unknown>)[field] = v; }, v);
  const ryg = elementRyg(el);
  return (
    <div className="card" style={{ margin: 0 }}>
      <h4>{CATALOG_BY_KEY[el.key]?.name} – kontrol listesi · <RygBadge r={ryg.ryg} /> <span className="muted small">{ryg.why}</span></h4>
      <table className="effects">
        <thead><tr><th>Soru</th><th>Öneri (proje verisi)</th><th>Cevap</th><th>Kanıt</th><th>Sapma</th><th>Aksiyon</th></tr></thead>
        <tbody>
          {el.checklist.map((c) => {
            const s = c.auto ? suggest(p, c.auto) : null;
            return (
              <tr key={c.id}>
                <td>{c.q}</td>
                <td className="small">{s && <><span className={`badge ${s.answer === 'Y' ? 'b-green' : 'b-amber'}`}>{s.answer || '—'}</span> {s.detail}</>}</td>
                <td><Select value={c.answer} options={['Y', 'N', 'NA']} onChange={(v) => setItem(c.id, 'answer', v)} /></td>
                <td><TextCell value={c.evidenceRef} onCommit={(v) => { setItem(c.id, 'evidenceRef', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><TextCell value={c.deviation} onCommit={(v) => { setItem(c.id, 'deviation', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><TextCell value={c.action} onCommit={(v) => { setItem(c.id, 'action', String(v ?? '')); return Promise.resolve(true); }} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form">
        <Field label="Kurtarma aksiyonu (Yellow için)"><TextCell value={el.recoveryAction} onCommit={(v) => { setEl('recoveryAction', String(v ?? '')); return Promise.resolve(true); }} /></Field>
        <label className="check-row"><input type="checkbox" checked={el.scheduleImpact} onChange={(e) => setEl('scheduleImpact', e.target.checked)} /><span>Teslim takvimine etki var (Red)</span></label>
        <Field label="Yeni soru"><input className="cell-input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <div><button className="btn" disabled={!q.trim()} onClick={() => { upd(el.key, 'checklist', (x) => { const e = x.elements.find((e) => e.key === el.key)!; e.checklist.push({ id: `Q${Date.now()}`, q: q.trim(), answer: '', evidenceRef: '', deviation: '', action: '' }); }, q, 'Added'); setQ(''); }}>+ Soru ekle</button></div>
      </div>
      <p className="muted small">Öneriler cevap değildir; cevabı mühendis seçer. Red: net “evet” yok ve kurtarma aksiyonu yok veya takvime etki var. Yellow: “hayır” + sağlam kurtarma planı. Green: tüm sorular evet (SCMH 7.2.3 §6.1).</p>
    </div>
  );
}

function PhasesTab() {
  const { p, a, upd } = useApqp();
  const t = dfmeaTiming(p);
  const setMs = (key: string, field: 'planned' | 'actual' | 'notes') => (v: unknown) => {
    upd(`milestone-${key}`, field, (x) => { (x.milestones.find((m) => m.key === key)!)[field] = String(v ?? ''); }, v);
    return Promise.resolve(true);
  };
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Fazlar (Red / Yellow / Green)</h3>
          <table className="effects">
            <tbody>
              {APQP_PHASES.map((ph, i) => {
                const els = a.elements.filter((e) => CATALOG_BY_KEY[e.key]?.phase === i + 1 && e.required === 'Y');
                const c = (r: Ryg) => els.filter((e) => elementRyg(e).ryg === r).length;
                return <tr key={ph}><td><b>{ph}</b></td><td><RygBadge r={phaseRyg(p, i + 1)} /></td><td className="small">{els.length} gerekli · {c('Green')} G · {c('Yellow')} Y · {c('Red')} R · {els.length - c('Green') - c('Yellow') - c('Red')} değerlendirilmedi</td></tr>;
              })}
            </tbody>
          </table>
          <p className="muted small">Faz durumu, fazdaki gerekli elemanların en kötü durumudur (SCMH 7.2.2 s.38, 7.2.3 §6.1).</p>
        </section>
        <section className="card">
          <h3>Kilometre taşları (SCMH 7.2.2)</h3>
          <table className="effects">
            <thead><tr><th></th><th>Kilometre taşı</th><th>Planlanan</th><th>Gerçekleşen</th><th>Durum</th></tr></thead>
            <tbody>
              {MILESTONES.map((m) => {
                const s = a.milestones.find((x) => x.key === m.key)!;
                return (
                  <tr key={m.key}>
                    <td><b>{m.key}</b></td><td>{m.label} <span className="muted small">Faz {m.phase}</span></td>
                    <td><TextCell type="date" value={s.planned} onCommit={setMs(m.key, 'planned')} /></td>
                    <td><TextCell type="date" value={s.actual} onCommit={setMs(m.key, 'actual')} /></td>
                    <td><RygBadge r={milestoneStatus(p, m.key)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card">
        <h3>DFMEA zamanlaması</h3>
        <p className="muted small">“The DFMEA is started after product initiation and finalized prior to design release” (DRA webinar s.38).</p>
        <div className="form">
          <Field label="PDR tarihi"><TextCell type="date" value={a.pdrDate} onCommit={(v) => { upd('pdrDate', 'pdrDate', (x) => { x.pdrDate = String(v ?? ''); }, v); return Promise.resolve(true); }} /></Field>
          <Field label="Tasarım serbest bırakma (design release / CDR) tarihi"><TextCell type="date" value={a.designReleaseDate} onCommit={(v) => { upd('designReleaseDate', 'designReleaseDate', (x) => { x.designReleaseDate = String(v ?? ''); }, v); return Promise.resolve(true); }} /></Field>
          <Field label="Design release DFMEA baseline’ı">
            <Select value={a.designReleaseBaselineId} options={p.baselines.map((b) => ({ key: b.id, label: `${b.id} · ${b.revision} · ${b.date.slice(0, 10)}` }))} onChange={(v) => upd('designReleaseBaselineId', 'designReleaseBaselineId', (x) => { x.designReleaseBaselineId = v; }, v)} />
          </Field>
        </div>
        <div className={`callout ${t.ok ? '' : 'warn'}`}>{t.detail}</div>
      </section>
    </div>
  );
}

function ApprovalsTab() {
  const { p, a, upd, toast, user } = useApqp();
  const [comment, setComment] = useState<Record<string, string>>({});
  const [cust, setCust] = useState<Record<string, { name: string; ref: string }>>({});
  const decide = (d: Deliverable, decision: 'Approved' | 'Rejected' | 'Returned') => {
    const step = deliverableNextStep(p, d);
    if (!step) return;
    const dec = { deliverable: d, step, decision, user, role: p.settings.userRole, comment: comment[d] ?? '', customerName: cust[d]?.name, customerRef: cust[d]?.ref };
    const err = deliverableDecisionError(p, dec);
    if (err) return toast(err, 'warn');
    const rec = recordDeliverableDecision(p, dec);
    upd(d, step, (x) => { x.deliverableApprovals.push(rec); }, decision, 'Approval', dec.comment);
    setComment((c) => ({ ...c, [d]: '' }));
    toast(`${d} · ${step}: ${decision}`);
  };
  return (
    <div className="page">
      <p className="muted">Teslimat bazında onay (SCMH 7.2.3: PFD Engineering/Operations/Quality, KP Quality/Production ve talep halinde müşteri). Proje onay akışından (Onay ekranı) bağımsızdır. AI onay veremez; karar veren: <b>{user || '— (Ayarlar’da kullanıcı adı girin)'}</b>.</p>
      <div className="two-col">
        {DELIVERABLES.map((d) => {
          const cfg = a.deliverableConfig.find((c) => c.deliverable === d)!;
          const done = deliverableApprovedSteps(p, d);
          const next = deliverableNextStep(p, d);
          return (
            <section key={d} className="card">
              <h3>{d} {deliverableApproved(p, d) ? <span className="badge b-green">Onaylı</span> : <span className="badge b-gray">Sıradaki: {next ?? '—'}</span>}</h3>
              <div className="form">
                <Field label="Onay adımları (virgülle)"><TextCell value={cfg.steps.join(', ')} onCommit={(v) => { upd(`config-${d}`, 'steps', (x) => { x.deliverableConfig.find((c) => c.deliverable === d)!.steps = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean); }, v); return Promise.resolve(true); }} /></Field>
                <label className="check-row"><input type="checkbox" checked={cfg.customerRequired} onChange={(e) => upd(`config-${d}`, 'customerRequired', (x) => { x.deliverableConfig.find((c) => c.deliverable === d)!.customerRequired = e.target.checked; }, e.target.checked)} /><span>Müşteri onayı gerekli</span></label>
              </div>
              <ol className="wf">
                {deliverableSteps(p, d).map((s) => <li key={s} className={done.has(s) ? 'done' : s === next ? 'cur' : ''}><span className="mark">{done.has(s) ? '✓' : s === next ? '●' : '○'}</span> {s}</li>)}
              </ol>
              {next && (
                <>
                  {next === 'Customer' && (
                    <div className="form">
                      <Field label="Müşteri tarafında onaylayan"><input className="cell-input" value={cust[d]?.name ?? ''} onChange={(e) => setCust((c) => ({ ...c, [d]: { name: e.target.value, ref: c[d]?.ref ?? '' } }))} /></Field>
                      <Field label="Yazılı onay referansı"><input className="cell-input" value={cust[d]?.ref ?? ''} onChange={(e) => setCust((c) => ({ ...c, [d]: { ref: e.target.value, name: c[d]?.name ?? '' } }))} /></Field>
                    </div>
                  )}
                  <textarea className="cell-input" rows={2} placeholder="Yorum (ret / iade için zorunlu)" value={comment[d] ?? ''} onChange={(e) => setComment((c) => ({ ...c, [d]: e.target.value }))} />
                  <div className="row-btns">
                    <button className="btn ok" onClick={() => decide(d, 'Approved')}>✓ {next} onayı</button>
                    <button className="btn" onClick={() => decide(d, 'Returned')}>↩ İade</button>
                    <button className="btn danger" onClick={() => decide(d, 'Rejected')}>✕ Ret</button>
                  </div>
                </>
              )}
              <table className="effects">
                <tbody>
                  {a.deliverableApprovals.filter((x) => x.deliverable === d).slice(-6).reverse().map((x) => (
                    <tr key={x.id}><td className="small nowrap">{fmtDate(x.at)}<div className="muted">{x.revision}</div></td><td><b>{x.step}</b> <span className={`badge ${x.decision === 'Approved' ? 'b-green' : x.decision === 'Rejected' ? 'b-red' : 'b-amber'}`}>{x.decision}</span><div className="small">{x.user}{x.customerName ? ` · müşteri: ${x.customerName} (${x.customerRef})` : ''}{x.comment ? ` – ${x.comment}` : ''}</div></td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TeamTab() {
  const { p, a, upd, mutate, toast, user } = useApqp();
  const gaps = teamGaps(p);
  const setM = (id: string, field: string, v: unknown) => upd(id, field, (x) => { (x.team.find((m) => m.id === id) as unknown as Record<string, unknown>)[field] = v; }, v);
  const ca = a.criteriaAgreement;
  const setCa = (field: keyof typeof ca) => (v: unknown) => { upd('criteriaAgreement', field, (x) => { (x.criteriaAgreement as unknown as Record<string, unknown>)[field] = String(v ?? ''); }, v); return Promise.resolve(true); };
  return (
    <div className="page">
      <section className="card">
        <h3>Çapraz fonksiyonel ekip</h3>
        <table className="effects">
          <thead><tr><th>İsim</th><th>Fonksiyon</th><th>DFMEA</th><th>PFMEA</th><th>E-posta</th><th></th></tr></thead>
          <tbody>
            {a.team.map((m) => (
              <tr key={m.id}>
                <td><TextCell value={m.name} onCommit={(v) => { setM(m.id, 'name', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><Select value={m.function} options={TEAM_FUNCTIONS} onChange={(v) => setM(m.id, 'function', v)} /></td>
                {(['DFMEA', 'PFMEA'] as const).map((f) => <td key={f}><input type="checkbox" checked={m.fmea.includes(f)} onChange={(e) => setM(m.id, 'fmea', e.target.checked ? [...m.fmea, f] : m.fmea.filter((x) => x !== f))} /></td>)}
                <td><TextCell value={m.email} onCommit={(v) => { setM(m.id, 'email', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><button className="btn ghost" onClick={() => upd(m.id, 'team', (x) => { x.team = x.team.filter((t) => t.id !== m.id); }, null, 'Deleted')}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-btns">
          <button className="btn" onClick={() => upd('team', 'team', (x) => { x.team.push({ id: `TM-${String(x.team.length + 1).padStart(3, '0')}-${Date.now() % 1000}`, name: '', function: '', fmea: [], email: '' }); }, null, 'Added')}>+ Üye</button>
          <button className="btn" disabled={!teamText(p)} onClick={() => { const t = teamText(p); mutate((d) => { d.meta.team = t; }, { kind: 'Modified', table: 'meta', id: 'team', field: 'team', from: p.meta.team, to: t, comment: 'APQP ekip listesinden' }); toast('Proje ekip metni güncellendi (SCMH başlığına yazılır)'); }}>Proje “FMEA ekibi” metnini güncelle</button>
        </div>
        <p className="muted small">Gerekli fonksiyonlar – DFMEA: {REQUIRED_FUNCTIONS.DFMEA.join(', ')}; PFMEA: {REQUIRED_FUNCTIONS.PFMEA.join(', ')} (SCMH 7.2.3 s.60; DRA Q&A Q11). FMEA işaretlenmemiş üye her ikisinde sayılır.</p>
        {gaps.map((g) => <div key={g.fmea} className="callout warn">{g.fmea} ekibinde eksik fonksiyon: {g.missing.join(', ')}</div>)}
      </section>
      <section className="card">
        <h3>Puanlama kriteri anlaşması {criteriaAgreed(p) ? <span className="badge b-green">Kayıtlı</span> : <span className="badge b-amber">Yok</span>}</h3>
        <p className="muted small">“Best practice is to have the DFMEA team agree on the ranking criteria before the DFMEA is started” (DRA Q&A Q6). Geçerli standart: {p.settings.scoringStandard}.</p>
        <div className="form">
          <Field label="Tarih"><TextCell type="date" value={ca.date} onCommit={setCa('date')} /></Field>
          <Field label="Kaynak"><Select value={ca.source} options={['SCMH template', 'AS13004', 'J1739', 'Company']} onChange={(v) => setCa('source')(v)} /></Field>
          <Field label="Anlaşan ekip üyeleri" wide><TextCell value={ca.members} onCommit={setCa('members')} /></Field>
          <Field label="Notlar / şirkete özel değişiklik (örn. maliyet tabanlı severity)" wide><TextCell multiline value={ca.notes} onCommit={setCa('notes')} /></Field>
        </div>
        <button className="btn" disabled={!user} onClick={() => upd('criteriaAgreement', 'recordedBy', (x) => { x.criteriaAgreement.recordedBy = user; x.criteriaAgreement.standard = p.settings.scoringStandard; }, user, 'Approval', 'Kriter anlaşması kaydedildi')}>Anlaşmayı {user || '—'} adına kaydet</button>
        {ca.recordedBy && <p className="small">Kaydeden: {ca.recordedBy} · standart: {ca.standard}</p>}
      </section>
    </div>
  );
}

function DraTab() {
  const { p, a, upd, edit, toast } = useApqp();
  const setP = (id: string, field: string) => (v: unknown) => { upd(id, field, (x) => { (x.pDiagrams.find((d) => d.id === id) as unknown as Record<string, unknown>)[field] = String(v ?? ''); }, v); return Promise.resolve(true); };
  const setM = (id: string, field: string, v: unknown) => upd(id, field, (x) => { (x.draMethods.find((d) => d.id === id) as unknown as Record<string, unknown>)[field] = v; }, v);
  const toDfmea = async (id: string) => {
    const d = a.pDiagrams.find((x) => x.id === id)!;
    const fn = p.structure.find((s) => s.id === d.structureId);
    const lines = d.unintendedOutputs.split(/\n|;/).map((s) => s.trim()).filter(Boolean).filter((l) => !p.dfmea.some((r) => r.failureMode === l));
    if (!lines.length) return toast('Eklenecek yeni istenmeyen çıktı yok', 'warn');
    const draft = structuredClone(p);
    const rows = lines.map((l) => {
      const rid = nextId(draft, 'dfmea');
      const row = { ...blankRow('dfmea', rid), functionId: fn?.id ?? '', component: fn?.element ?? '', failureMode: l, origin: 'template', dataStatus: 'ENGINEERING SUGGESTION – VERIFY', source: `P-diyagramı ${id}`, notes: 'P-diyagramı istenmeyen çıktısından taslak; etki, neden ve S/O/D mühendis tarafından girilir.' } as AnyRow;
      draft.dfmea.push(row as never);
      return row;
    });
    if (await edit(rows.map((row) => ({ kind: 'add' as const, table: 'dfmea' as const, row })), 'P-diyagramından DFMEA taslakları')) toast(`${rows.length} DFMEA taslağı eklendi`);
  };
  const NOISE: [string, string][] = [['noisePieceToPiece', 'Gürültü: parçadan parçaya'], ['noiseChangeOverTime', 'Gürültü: zamanla değişim'], ['noiseCustomerUsage', 'Gürültü: müşteri kullanımı'], ['noiseEnvironment', 'Gürültü: dış ortam'], ['noiseSystemInteraction', 'Gürültü: sistem etkileşimi']];
  return (
    <div className="page">
      <section className="card">
        <h3>P-diyagramları</h3>
        <p className="muted small">P-diyagramı “typically as an input to FMEA’s” (DRA webinar s.23). İstenmeyen çıktılar (satır başına bir tane) DFMEA hata modu taslağına dönüştürülebilir.</p>
        {a.pDiagrams.map((d) => (
          <div key={d.id} className="card">
            <h4>{d.id}</h4>
            <div className="form">
              <Field label="Yapı / fonksiyon"><Select value={d.structureId} options={p.structure.map((s) => ({ key: s.id, label: `${s.id} – ${s.element} ${s.function}`.slice(0, 80) }))} onChange={(v) => setP(d.id, 'structureId')(v)} /></Field>
              <Field label="Girdiler"><TextCell multiline value={d.inputs} onCommit={setP(d.id, 'inputs')} /></Field>
              <Field label="İstenen çıktılar"><TextCell multiline value={d.intendedOutputs} onCommit={setP(d.id, 'intendedOutputs')} /></Field>
              <Field label="İstenmeyen çıktılar (→ hata modları)"><TextCell multiline value={d.unintendedOutputs} onCommit={setP(d.id, 'unintendedOutputs')} /></Field>
              <Field label="Kontrol faktörleri"><TextCell multiline value={d.controlFactors} onCommit={setP(d.id, 'controlFactors')} /></Field>
              {NOISE.map(([k, l]) => <Field key={k} label={l}><TextCell multiline value={(d as unknown as Record<string, string>)[k]} onCommit={setP(d.id, k)} /></Field>)}
            </div>
            <div className="row-btns">
              <button className="btn" onClick={() => toDfmea(d.id)}>İstenmeyen çıktılardan DFMEA taslağı</button>
              <button className="btn ghost" onClick={() => upd(d.id, 'pDiagrams', (x) => { x.pDiagrams = x.pDiagrams.filter((y) => y.id !== d.id); }, null, 'Deleted')}>Sil</button>
            </div>
          </div>
        ))}
        <button className="btn" onClick={() => upd('pDiagrams', 'pDiagrams', (x) => { x.pDiagrams.push({ id: `PD-${String(x.pDiagrams.length + 1).padStart(3, '0')}`, structureId: '', inputs: '', intendedOutputs: '', unintendedOutputs: '', controlFactors: '', noisePieceToPiece: '', noiseChangeOverTime: '', noiseCustomerUsage: '', noiseEnvironment: '', noiseSystemInteraction: '', notes: '' }); }, null, 'Added')}>+ P-diyagramı</button>
      </section>
      <section className="card">
        <h3>DRA yöntem kaydı</h3>
        <p className="muted small">DFMEA “risks and knowledge gaps, with mitigation activities … via other DRA methods” (DRA Q&A Q29); bilgi boşluğu sınıfları DRA webinar s.16–17.</p>
        <table className="effects">
          <thead><tr><th>ID</th><th>Yöntem</th><th>Bilgi boşluğu</th><th>DFMEA</th><th>Açıklama</th><th>Sonuç</th><th>Kanıt</th><th></th></tr></thead>
          <tbody>
            {a.draMethods.map((m) => (
              <tr key={m.id}>
                <td className="rid">{m.id}</td>
                <td><Select value={m.method} options={DRA_METHODS} onChange={(v) => setM(m.id, 'method', v)} /></td>
                <td><Select value={m.knowledgeGap} options={KNOWLEDGE_GAPS} onChange={(v) => setM(m.id, 'knowledgeGap', v)} /></td>
                <td><TextCell value={m.dfIds.join(', ')} onCommit={(v) => { setM(m.id, 'dfIds', String(v ?? '').split(/[,;\s]+/).filter((x) => p.dfmea.some((d) => d.id === x))); return Promise.resolve(true); }} /></td>
                <td><TextCell multiline value={m.description} onCommit={(v) => { setM(m.id, 'description', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><TextCell multiline value={m.result} onCommit={(v) => { setM(m.id, 'result', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><TextCell value={m.evidenceRef} onCommit={(v) => { setM(m.id, 'evidenceRef', String(v ?? '')); return Promise.resolve(true); }} /></td>
                <td><button className="btn ghost" onClick={() => upd(m.id, 'draMethods', (x) => { x.draMethods = x.draMethods.filter((y) => y.id !== m.id); }, null, 'Deleted')}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn" onClick={() => upd('draMethods', 'draMethods', (x) => { x.draMethods.push({ id: `DRA-${String(x.draMethods.length + 1).padStart(3, '0')}`, method: '', knowledgeGap: '', dfIds: [], description: '', result: '', evidenceRef: '' }); }, null, 'Added')}>+ Yöntem</button>
      </section>
    </div>
  );
}

function CpTab({ go }: { go: Go }) {
  const { p, a, upd, edit, toast } = useApqp();
  const cand = cpPromotionCandidates(p);
  const count = (ph: string) => p.controlPlan.filter((c) => c.phases?.includes(ph as never)).length;
  const unassigned = p.controlPlan.filter((c) => !c.phases?.length).length;
  const promote = async () => {
    const edits = cand.map((id) => ({ kind: 'set' as const, table: 'controlPlan' as const, id, field: 'phases', value: [...(p.controlPlan.find((c) => c.id === id)!.phases ?? []), 'Production'] }));
    if (await edit(edits, 'Pre-launch → Production')) toast(`${edits.length} KP satırı Production fazına eklendi`);
  };
  const ad = a.cpAdmin;
  const setAd = (k: keyof typeof ad) => (v: unknown) => { upd('cpAdmin', k, (x) => { x.cpAdmin[k] = String(v ?? ''); }, v); return Promise.resolve(true); };
  const F: [keyof typeof ad, string, string?][] = [
    ['supplierCode', 'Tedarikçi kodu'], ['keyContact', 'Ana irtibat kişisi'], ['keyContactPhone', 'İrtibat telefonu'],
    ['customerEngApprovalBy', 'Müşteri mühendislik onayı'], ['customerEngApprovalDate', 'Tarih', 'date'],
    ['customerQualityApprovalBy', 'Müşteri kalite onayı'], ['customerQualityApprovalDate', 'Tarih', 'date'],
    ['otherApprovalBy', 'Diğer onay (gerekirse)'], ['otherApprovalDate', 'Tarih', 'date'],
  ];
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Kontrol planı fazları</h3>
          <p className="muted small">Prototype, Pre-Launch, Production (CP webinar s.20); ön kontrol planı üretim kontrol planına dönüşür (CP Q&A Q12). Fazı boş satır her fazda yer alır. SCMH paketi atanmış her faz için ayrı KP dosyası üretir; 7.2.13 şablonunda yalnızca Pre-Production / Production kutusu olduğundan Prototype “Pre-Production” işaretlenir.</p>
          <table className="effects"><tbody>
            {CP_PHASES.map((ph) => <tr key={ph}><td>{ph}</td><td>{count(ph)} satır</td></tr>)}
            <tr><td>Fazı atanmamış</td><td>{unassigned} satır</td></tr>
          </tbody></table>
          {cand.length > 0 && (
            <div className="callout">
              Yalnızca Pre-launch fazında olan {cand.length} satır: {cand.join(', ')}.{' '}
              <button className="btn" onClick={promote}>Production fazına ekle</button>
            </div>
          )}
          <button className="btn ghost" onClick={() => go('controlPlan')}>Kontrol Planı ekranına git</button>
        </section>
        <section className="card">
          <h3>KP yönetim başlığı</h3>
          <p className="muted small">“Identifies part number and description, supplier, required approval signatures, and dates” (CP webinar s.21). 7.2.13 şablonunda bu alanlar için hücre yoktur; tedarikçi kodu 7.2.20 formunda kullanılır.</p>
          <div className="form">{F.map(([k, l, t]) => <Field key={k} label={l}><TextCell type={t} value={ad[k]} onCommit={setAd(k)} /></Field>)}</div>
        </section>
      </div>
    </div>
  );
}

function PackagingTab() {
  const { p, a, upd, edit, toast, user } = useApqp();
  const k = a.packaging;
  const setK = (field: string) => (v: unknown) => { upd('packaging', field, (x) => { (x.packaging as unknown as Record<string, unknown>)[field] = v; }, v); return Promise.resolve(true); };
  const setItem = (key: string, field: 'answer' | 'note', v: string) => upd(`packaging.${key}`, field, (x) => { x.packaging.items.find((i) => i.key === key)![field] = v as never; }, v);
  const [appr, setAppr] = useState({ by: k.customerApprover, date: k.approvalDate });
  const drafts = packagingPfmeaDrafts(p);
  const issues = packagingIssues(p);
  const H: [keyof typeof k, string, string][] = [
    ['customerPartNo', 'Müşteri parça no', p.meta.partNumber], ['customerPartDesc', 'Müşteri parça tanımı', p.meta.partName], ['customerPartRev', 'Müşteri parça revizyonu', p.meta.drawingRevision],
    ['supplierPartNo', 'Tedarikçi parça no (varsa)', ''], ['supplierName', 'Tedarikçi adı', p.meta.supplier || p.meta.organization], ['supplierCode', 'Tedarikçi kodu', a.cpAdmin.supplierCode],
  ];
  const addDrafts = async () => {
    const draft = structuredClone(p);
    const rows = drafts.map((d) => {
      const id = nextId(draft, 'pfmea');
      const row = { ...blankRow('pfmea', id), ...d, id } as AnyRow;
      draft.pfmea.push(row as never);
      return row;
    });
    if (await edit(rows.map((row) => ({ kind: 'add' as const, table: 'pfmea' as const, row })), '7.2.20 → PFMEA taslakları')) toast(`${rows.length} PFMEA taslağı eklendi`);
  };
  return (
    <div className="page">
      <section className="card">
        <h3>Parça ambalaj / koruma / etiketleme onayı (SCMH 7.2.20) {packagingApproved(p) ? <span className="badge b-green">Müşteri onaylı</span> : <span className="badge b-amber">Onay yok</span>}</h3>
        <div className="form">
          {H.map(([f, l, def]) => <Field key={f} label={`${l}${def ? ` (boşsa: ${def})` : ''}`}><TextCell value={k[f] as string} onCommit={setK(f)} /></Field>)}
          <Field label="Ambalaj gereksinim temeli"><Select value={k.basis} options={['Standard commercial', 'Customer unique']} onChange={(v) => setK('basis')(v)} /></Field>
          <Field label="Standart (örn. ASTM D3951 / BS1133 / ATA300)"><TextCell value={k.standardRef} onCommit={setK('standardRef')} /></Field>
          <Field label="Müşteriye özel ambalaj spesifikasyonu"><TextCell value={k.customerSpec} onCommit={setK('customerSpec')} /></Field>
        </div>
        <table className="effects">
          <thead><tr><th>#</th><th>Madde</th><th>Cevap</th><th>Not</th></tr></thead>
          <tbody>
            {k.items.map((i, n) => (
              <tr key={i.key}>
                <td>{n + 1}</td><td>{i.label}{i.custom && <span className="muted small"> (şirket maddesi; formda yok)</span>}</td>
                <td><Select value={i.answer} options={['Yes', 'No', 'N/A']} onChange={(v) => setItem(i.key, 'answer', v)} /></td>
                <td><TextCell value={i.note} onCommit={(v) => { setItem(i.key, 'note', String(v ?? '')); return Promise.resolve(true); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn ghost" onClick={() => { const label = window.prompt('Yeni madde'); if (label) upd('packaging', 'items', (x) => { x.packaging.items.push({ key: `c${Date.now()}`, label, answer: '', note: '', custom: true }); }, label, 'Added'); }}>+ Şirket maddesi</button>
        <div className="form">
          <Field label="Ambalaj iş talimatı (doküman / dosya referansı)"><TextCell value={k.workInstructionRef} onCommit={setK('workInstructionRef')} /></Field>
          <Field label="Birim / ara ambalaj ve paketleme fotoğrafları"><TextCell value={k.packPhotoRef} onCommit={setK('packPhotoRef')} /></Field>
          <Field label="Ambalaj etiketi fotoğrafı"><TextCell value={k.labelPhotoRef} onCommit={setK('labelPhotoRef')} /></Field>
        </div>
        {drafts.length > 0 && (
          <div className="callout warn">“Hayır” cevaplı {drafts.length} madde için paketleme adımına PFMEA taslağı önerilir (ENGINEERING SUGGESTION, S/O/D boş): {drafts.map((d) => d.failureMode).join('; ')}. <button className="btn" onClick={addDrafts}>PFMEA taslaklarını ekle</button></div>
        )}
      </section>
      <section className="card">
        <h3>3. Müşteri ambalaj onayı</h3>
        {issues.length > 0 && <div className="callout warn">{issues.join('; ')}</div>}
        <div className="form">
          <Field label="Müşteri adına onaylayan"><input className="cell-input" value={appr.by} onChange={(e) => setAppr({ ...appr, by: e.target.value })} /></Field>
          <Field label="Onay tarihi"><input className="cell-input" type="date" value={appr.date} onChange={(e) => setAppr({ ...appr, date: e.target.value })} /></Field>
        </div>
        <button className="btn ok" onClick={() => {
          if (!user) return toast('Kayıt için Ayarlar’da kullanıcı adı girilmelidir.', 'warn');
          const err = packagingApprovalError(p);
          if (err) return toast(err, 'warn');
          if (!appr.by.trim() || !appr.date) return toast('Onaylayan ve tarih zorunludur.', 'warn');
          upd('packaging', 'customerApproval', (x) => { x.packaging.customerApprover = appr.by.trim(); x.packaging.approvalDate = appr.date; x.packaging.recordedBy = user; }, appr, 'Approval', 'Müşteri ambalaj onayı kaydedildi');
          toast('Müşteri onayı kaydedildi');
        }}>Müşteri onayını kaydet</button>
        <p className="muted small">İmza alanı SCMH formunda boş bırakılır. Onay, tedarikçiyi kullanım noktasına kadar ambalaj performansı sorumluluğundan kurtarmaz.{k.recordedBy && ` Kaydeden: ${k.recordedBy}.`}</p>
      </section>
    </div>
  );
}

function ReuseTab({ go }: { go: Go }) {
  const { p, a, upd, edit, toast } = useApqp();
  const [plan, setPlan] = useState<{ name: string; rows: { table: string; row: AnyRow }[]; src: string } | null>(null);
  const [opt, setOpt] = useState({ dfmea: true, process: true });
  const fam = a.family;
  const setF = (k: keyof typeof fam) => (v: unknown) => { upd('family', k, (x) => { x.family[k] = String(v ?? ''); }, v); return Promise.resolve(true); };
  const pick = async () => {
    const r = await api.openReference();
    if (!r) return;
    setPlan({ name: r.name, src: r.name, rows: [] });
    setRef(r.data);
  };
  const [ref, setRef] = useState<Project | null>(null);
  const rows = useMemo(() => (ref ? reuseRows(p, ref, opt) : []), [ref, p, opt]);
  const apply = async () => {
    if (!plan || !rows.length) return;
    const ok = await edit(rows.map((r) => ({ kind: 'add' as const, table: r.table as never, row: r.row })), `Yeniden kullanım: ${plan.name}`);
    if (ok) {
      upd('family', 'reusedFrom', (x) => { x.family.reusedFrom = plan.name; }, plan.name, 'Import');
      toast(`${rows.length} kayıt kopyalandı; S/O/D yeniden puanlanmalı`);
      setPlan(null);
      setRef(null);
    }
  };
  const trig = p.lessons.filter((l) => isUpdateTrigger(l));
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Parça / proses ailesi</h3>
          <p className="muted small">Aile DRA’ları “reviewed for commonality of design, function, and operating environment” ise kabul edilir (SCMH 7.2.3 s.32). Yüksek çeşit/düşük hacimde parça ve proses aileleri, proses başına PFMEA ve KP (PPAP webinar s.8).</p>
          <div className="form">
            <Field label="Aile adı"><TextCell value={fam.name} onCommit={setF('name')} /></Field>
            <Field label="Parça numaraları"><TextCell value={fam.partNumbers} onCommit={setF('partNumbers')} /></Field>
            <Field label="Tasarım ortaklığı" wide><TextCell multiline value={fam.commonalityDesign} onCommit={setF('commonalityDesign')} /></Field>
            <Field label="Fonksiyon ortaklığı" wide><TextCell multiline value={fam.commonalityFunction} onCommit={setF('commonalityFunction')} /></Field>
            <Field label="Çalışma ortamı ortaklığı" wide><TextCell multiline value={fam.commonalityEnvironment} onCommit={setF('commonalityEnvironment')} /></Field>
            <Field label="Proses ailesi (aynı akış / ortak özellikler)" wide><TextCell multiline value={fam.processFamily} onCommit={setF('processFamily')} /></Field>
            <Field label="Ortaklığı doğrulayan"><TextCell value={fam.confirmedBy} onCommit={setF('confirmedBy')} /></Field>
            <Field label="Tarih"><TextCell type="date" value={fam.date} onCommit={setF('date')} /></Field>
          </div>
          {fam.reusedFrom && <p className="small">Başlangıç FMEA’sı: {fam.reusedFrom}</p>}
        </section>
        <section className="card">
          <h3>Mevcut FMEA’dan başla</h3>
          <p className="muted small">“The existing DFMEA can then be used as a starting point for new designs” (DRA webinar s.38). Yapı, fonksiyon, hata modu, neden, kontroller, proses akışı ve KP iskeleti kopyalanır; S/O/D, spesifikasyon ve örnek/sıklık kopyalanmaz (VERİ YOK), PFMEA satırları “Preliminary” başlar.</p>
          <label className="check-row"><input type="checkbox" checked={opt.dfmea} onChange={(e) => setOpt({ ...opt, dfmea: e.target.checked })} /> Yapı + DFMEA</label>{' '}
          <label className="check-row"><input type="checkbox" checked={opt.process} onChange={(e) => setOpt({ ...opt, process: e.target.checked })} /> PFD + PFMEA + KP</label>
          <div className="row-btns"><button className="btn" disabled={!isDesktop} onClick={pick}>.fmea dosyası seç…</button></div>
        </section>
      </div>
      <section className="card">
        <h3>FMEA güncelleme tetikleyicileri</h3>
        <p className="muted small">NCR, üretim koşusu ve sürekli iyileştirme kayıtları FMEA satırına bağlandığında satır “FMEA Reassessment Required” olur (SCMH 7.2.3 s.59, s.82, s.99–100); değişiklik onay penceresinde gösterilir.</p>
        <table className="effects">
          <thead><tr><th>Ders</th><th>Kaynak</th><th>Bağlı FMEA satırları</th><th>Yeniden değerlendirme</th></tr></thead>
          <tbody>
            {trig.map((l) => (
              <tr key={l.id}>
                <td className="rid">{l.id}</td><td>{l.sourceType} {l.reference}</td><td>{l.linkedFmeaIds.join(', ') || <span className="badge b-amber">bağlı değil</span>}</td>
                <td className="small">{l.linkedFmeaIds.map((id) => { const r = [...p.dfmea, ...p.pfmea].find((x) => x.id === id); return `${id}: ${r?.reassess ? 'bekliyor' : 'değerlendirildi / yok'}`; }).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn ghost" onClick={() => go('lessons')}>Dersler ekranına git</button>
      </section>
      {plan && (
        <Modal title={`Yeniden kullanım: ${plan.name}`} sub={`${rows.length} kayıt eklenecek (yeni ID’lerle).`} onClose={() => { setPlan(null); setRef(null); }}
          foot={<><button className="btn" onClick={() => { setPlan(null); setRef(null); }}>Vazgeç</button><button className="btn primary" disabled={!rows.length} onClick={apply}>Ekle</button></>}>
          <p className="small">{['structure', 'dfmea', 'processSteps', 'pfmea', 'controlPlan'].map((t) => `${t}: ${rows.filter((r) => r.table === t).length}`).join(' · ')}</p>
        </Modal>
      )}
    </div>
  );
}

function MaturityTab() {
  const { p } = useApqp();
  return (
    <div className="page">
      <section className="card">
        <h3>Olgunluk matrisi kanıtı (SCMH 7.2.14, 4.1–4.7)</h3>
        <p className="muted small">Olgunluk değerlendirmesi kuruluş düzeyindedir ve puan değerlendiricinindir. Uygulama yalnızca proje verisinden objektif kanıt üretir; SCMH paketi bu metinleri şablonun Data sayfası J (Comment / Evidence) sütununa yazar, I (Score) sütununa dokunmaz.</p>
        <table className="effects"><tbody>{maturityEvidence(p).map((e) => <tr key={e.item}><td><b>{e.item}</b></td><td>{e.text}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

// ═════════════════════════ PPAP ═════════════════════════

export function PpapScreen({ sub, go }: { sub?: string; go: Go }) {
  if (sub === 'prr') return <PrrTab go={go} />;
  if (sub === 'submissions') return <SubmissionsTab />;
  return <PpapElementsTab go={go} />;
}

function PpapElementsTab({ go }: { go: Go }) {
  const { p, a, upd } = useApqp();
  const ready = ppapReadiness(p);
  const ship = shipmentAllowed(p);
  const rs = ppapResubmission(p);
  const setE = (no: number, field: string, v: unknown) => upd(`ppap-${no}`, field, (x) => { (x.ppap.elements.find((e) => e.no === no) as unknown as Record<string, unknown>)[field] = v; }, v);
  return (
    <div className="page">
      {!a.projectType && <div className="callout warn">APQP proje tipi seçilmedi. <button className="btn" onClick={() => go('apqp')}>APQP ekranı</button></div>}
      <div className={`callout ${ship.ok ? '' : 'warn'}`}>Sevkiyat: {ship.ok ? '✓ yazılı PPAP onayı var' : '✕ yazılı PPAP onayı yok – sevkiyat yapılmaz'} ({ship.why}).{rs.required && ` Yeniden sunum gerekli: ${rs.reasons.join('; ')}.`}</div>
      <section className="card">
        <h3>PPAP elemanları (PPAP webinar s.18)</h3>
        <table className="effects">
          <thead><tr><th>#</th><th>Eleman</th><th>Faz</th><th>Sunumda</th><th>Durum</th><th>Hazırlık (öneri)</th><th>Dosya / referans</th><th>Not</th></tr></thead>
          <tbody>
            {PPAP_ELEMENTS.map((d) => {
              const e = a.ppap.elements.find((x) => x.no === d.no)!;
              const r = ready.find((x) => x.no === d.no)!;
              return (
                <tr key={d.no}>
                  <td>{d.no}</td><td>{d.name}{d.designOwned && <span title="Tasarım sorumlusu kuruluş"> *</span>}</td><td>{d.phase}</td>
                  <td><input type="checkbox" checked={e.required} onChange={(ev) => setE(d.no, 'required', ev.target.checked)} /></td>
                  <td><Select value={e.status} options={['Not started', 'In work', 'Complete', 'N/A']} onChange={(v) => setE(d.no, 'status', v)} /></td>
                  <td className="small"><span className={`badge ${r.ok ? 'b-green' : 'b-amber'}`}>{r.ok ? 'Hazır' : 'Eksik'}</span> {r.detail}</td>
                  <td><TextCell value={e.ref} onCommit={(v) => { setE(d.no, 'ref', String(v ?? '')); return Promise.resolve(true); }} /></td>
                  <td><TextCell value={e.notes} onCommit={(v) => { setE(d.no, 'notes', String(v ?? '')); return Promise.resolve(true); }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Hazırlık kuralları öneridir; elemanın durumu mühendis tarafından girilir. PPAP dosyası tüm elemanları içerir, sunum müşterinin istediklerini (s.33). 9145 Appendix D formu uygulama tarafından üretilmez.</p>
      </section>
    </div>
  );
}

function PrrTab({ go }: { go: Go }) {
  const { p, a, upd, toast, user } = useApqp();
  const blockers = prrBlockers(p);
  const mitig = mitigatedOpenActions(p);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const approveMit = (id: string) => {
    if (!user) return toast('Onay için Ayarlar’da kullanıcı adı girilmelidir.', 'warn');
    const note = (notes[id] ?? a.actionMitigations.find((m) => m.actionId === id)?.note ?? '').trim();
    if (!note) return toast('Azaltma planı metni zorunludur.', 'warn');
    upd(id, 'mitigation', (x) => { x.actionMitigations = [...x.actionMitigations.filter((m) => m.actionId !== id), { actionId: id, note, approvedBy: user, date: new Date().toISOString().slice(0, 10) }]; }, note, 'Approval', 'Açık aksiyon için azaltma planı onaylandı');
  };
  const decidePrr = (decision: 'Passed' | 'Failed') => {
    const err = prrDecisionError(p, decision, user, comment);
    if (err) return toast(err, 'warn');
    upd('prr', 'decision', (x) => { x.prr = { date: new Date().toISOString().slice(0, 10), decision, decidedBy: user, comment }; }, decision, 'Approval', comment);
    toast(`PRR: ${decision}`);
  };
  const act = (id: string) => p.actions.find((x) => x.id === id)!;
  return (
    <div className="page">
      <section className="card">
        <h3>PRR kapısı (APQP 3.12) {a.prr.decision && <span className={`badge ${a.prr.decision === 'Passed' ? 'b-green' : 'b-red'}`}>{a.prr.decision} · {a.prr.date} · {a.prr.decidedBy}</span>}</h3>
        <p className="muted small">“Management should confirm that all outstanding actions are satisfactorily closed or mitigated before the significant production run” (SCMH 7.2.3 s.78). APQP projesinde Final Approval ve Baseline adımları da bu kapıya bağlıdır.</p>
        {blockers.length === 0 ? <p className="ok-text">✓ Engelleyen açık aksiyon yok.</p> : <div className="callout warn">{blockers.length} açık FMEA aksiyonu PRR’yi engelliyor.</div>}
        <table className="effects">
          <thead><tr><th>Aksiyon</th><th>Kaynak</th><th>Durum / termin</th><th>Azaltma planı</th><th></th></tr></thead>
          <tbody>
            {[...blockers, ...mitig].map((id) => {
              const x = act(id);
              const m = a.actionMitigations.find((y) => y.actionId === id);
              return (
                <tr key={id}>
                  <td className="rid">{id}<div className="small">{x.description}</div></td>
                  <td className="rid">{x.sourceId}</td>
                  <td className="small">{x.status} · {x.dueDate || '—'}</td>
                  <td><input className="cell-input" value={notes[id] ?? m?.note ?? ''} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} />{m?.approvedBy && <div className="small">Onaylayan: {m.approvedBy} ({m.date})</div>}</td>
                  <td>{blockers.includes(id) ? <button className="btn" onClick={() => approveMit(id)}>Planı onayla</button> : <span className="badge b-green">Azaltıldı</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <textarea className="cell-input" rows={2} placeholder="PRR yorumu (başarısız için zorunlu)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="row-btns">
          <button className="btn ok" onClick={() => decidePrr('Passed')}>✓ PRR geçti</button>
          <button className="btn danger" onClick={() => decidePrr('Failed')}>✕ PRR başarısız</button>
          <button className="btn ghost" onClick={() => go('actions')}>Aksiyonlar</button>
        </div>
      </section>
    </div>
  );
}

function SubmissionsTab() {
  const { p, a, upd, toast, user } = useApqp();
  const blank = (): PpapSubmission => ({ id: '', date: new Date().toISOString().slice(0, 10), level: '', disposition: '', interimUntil: '', reasons: interimReasonSuggestion(p), restrictions: '', customerApprover: '', writtenApprovalRef: '', recordedBy: user, revision: p.meta.fmeaRevision });
  const [f, setF] = useState<PpapSubmission>(blank);
  const set = (k: keyof PpapSubmission) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const s = { ...f, recordedBy: user, id: `PPAP-${String(a.ppap.submissions.length + 1).padStart(3, '0')}` };
    const err = submissionError(s);
    if (err) return toast(err, 'warn');
    upd(s.id, 'disposition', (x) => { x.ppap.submissions.push(s); }, s.disposition, 'Approval', `Müşteri PPAP kararı kaydedildi (${s.customerApprover})`);
    toast(`PPAP kararı kaydedildi: ${s.disposition}`);
    setF(blank());
  };
  const rs = ppapResubmission(p);
  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <h3>Müşteri PPAP kararını kaydet</h3>
          <p className="muted small">Kararı müşteri verir; burada yazılı kararı kaydedersiniz. Full / Interim (kök neden + geçici plan, süre veya miktar sınırlı, yeniden sunum gerekir) / Rejected (PPAP webinar s.34–36).</p>
          <div className="form">
            <Field label="Tarih"><input className="cell-input" type="date" value={f.date} onChange={set('date')} /></Field>
            <Field label="Sunum seviyesi / kapsamı"><input className="cell-input" value={f.level} onChange={set('level')} /></Field>
            <Field label="Karar"><Select value={f.disposition} options={['Full', 'Interim', 'Rejected']} onChange={(v) => setF({ ...f, disposition: v as PpapSubmission['disposition'] })} /></Field>
            <Field label="Interim sınırı (tarih / miktar)"><input className="cell-input" value={f.interimUntil} onChange={set('interimUntil')} /></Field>
            <Field label="Müşteri tarafında karar veren"><input className="cell-input" value={f.customerApprover} onChange={set('customerApprover')} /></Field>
            <Field label="Yazılı onay referansı"><input className="cell-input" value={f.writtenApprovalRef} onChange={set('writtenApprovalRef')} /></Field>
            <Field label="Gerekçe (Interim / Rejected)" wide><textarea className="cell-input" rows={2} value={f.reasons} onChange={set('reasons')} /></Field>
            <Field label="Kısıtlamalar" wide><textarea className="cell-input" rows={2} value={f.restrictions} onChange={set('restrictions')} /></Field>
          </div>
          <button className="btn primary" onClick={save}>Kararı {user || '—'} adına kaydet</button>
        </section>
        <section className="card">
          <h3>Karar geçmişi</h3>
          {rs.required && <div className="callout warn">Yeniden sunum gerekli: {rs.reasons.join('; ')}</div>}
          <table className="effects">
            <tbody>
              {[...a.ppap.submissions].reverse().map((s) => (
                <tr key={s.id}><td className="rid">{s.id}<div className="muted small">{s.date} · {s.revision}</div></td><td><span className={`badge ${s.disposition === 'Full' ? 'b-green' : s.disposition === 'Rejected' ? 'b-red' : 'b-amber'}`}>{s.disposition}</span> {s.customerApprover} · {s.writtenApprovalRef}<div className="small">{s.interimUntil && `Sınır: ${s.interimUntil}. `}{s.reasons}</div><div className="muted small">Kaydeden: {s.recordedBy}</div></td></tr>
              ))}
            </tbody>
          </table>
          {a.ppap.submissions.length === 0 && <p className="muted">Kayıt yok.</p>}
        </section>
      </div>
    </div>
  );
}
