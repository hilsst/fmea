// v4-cap: Capability ve MSA ekranları – AS9145 Tablo 1 bandı, SPC kartı seçimi, PPM/Z, veri kaynağı,
// Occurrence önerisi, yapılandırılmış MSA (gauge seçimi, GR&R tasarımı, müşteri kriteri).
import { useState } from 'react';
import { BAND_LABEL, guidelineColor, linkedPfmea, msaBlocker, occurrenceFromCapability, provenanceIssues, requiredReactions, rowCapability } from '../../shared/capBand';
import { AS9145_ACCEPTANCE, DEFAULT_MIN_SUBGROUPS, DEFAULT_MSA_CRITERIA } from '../../shared/capDefaults';
import { capReactionEdits } from '../../shared/capEngine';
import type { Edit } from '../../shared/engine';
import { blankRow, nextId } from '../../shared/model';
import { evaluateMsa, msaCovers, msaStudyFor, needsMsa } from '../../shared/msa';
import type { AnyRow, CapAcceptance, MsaCriteria, Project, TableKey } from '../../shared/types';
import { TextCell } from '../components/Cells';
import { Grid } from '../components/Grid';
import { useStore } from '../store';

const f = (v: number | null | undefined, n = 3) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(n));
const ppm = (v: number | null | undefined) => (v == null ? '—' : v < 1 ? v.toFixed(3) : String(Math.round(v)));
const BAND_BADGE: Record<string, string> = { ACCEPT: 'b-green', CONDITIONAL: 'b-amber', REJECT: 'b-red' };
const GUIDE_BADGE: Record<string, string> = { green: 'b-green', yellow: 'b-amber', red: 'b-red' };

function addBatch(project: Project) {
  let p = project;
  const edits: Edit[] = [];
  return {
    add(table: TableKey, data: Partial<AnyRow>) {
      const id = nextId(p, table);
      const row = { ...blankRow(table, id), ...data, id } as AnyRow;
      p = { ...p, [table]: [...(p[table] as AnyRow[]), row] };
      edits.push({ kind: 'add', table, row });
    },
    edits,
  };
}

// ───────────────────────── Ayar kartları ─────────────────────────

function NumField({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => Promise<boolean> }) {
  return (
    <label>
      <span>{label}</span>
      <TextCell value={value ?? ''} type="number" onCommit={(v) => onCommit(v as number | null)} />
    </label>
  );
}

function CapCriteriaCard() {
  const { project: p, edit } = useStore();
  const acc: CapAcceptance = p.settings.capAcceptance ?? AS9145_ACCEPTANCE;
  const setAcc = (patch: Partial<CapAcceptance>) => edit({ kind: 'settings', field: 'capAcceptance', value: { ...acc, ...patch } }, 'Capability kabul bandı');
  return (
    <details className="card">
      <summary><b>Kabul kriterleri</b> · ≥{acc.accept} ACCEPT · {acc.conditional}–{acc.accept} CONDITIONAL · &lt;{acc.conditional} REJECT <span className="muted small">({acc.source || 'kaynak VERİ YOK'})</span></summary>
      <div className="form">
        <NumField label="Kabul eşiği (Cpk/Ppk ≥)" value={acc.accept} onCommit={(v) => (v == null ? Promise.resolve(false) : setAcc({ accept: v }))} />
        <NumField label="Koşullu alt sınır (≥)" value={acc.conditional} onCommit={(v) => (v == null ? Promise.resolve(false) : setAcc({ conditional: v }))} />
        <label><span>Kaynak</span><TextCell value={acc.source} onCommit={(v) => setAcc({ source: String(v) })} /></label>
        <NumField label={`Minimum alt grup (boş = ${DEFAULT_MIN_SUBGROUPS}, CAP p38)`} value={p.settings.minSubgroups} onCommit={(v) => edit({ kind: 'settings', field: 'minSubgroups', value: v }, 'Ayar değişikliği')} />
      </div>
      <p className="muted small">Varsayılan AS9145 Tablo 1 (SCMH PPAP webinar p26). Müşteri daha sıkı kriter verebilir. CAP p66 renk kılavuzu yalnızca ikincil ipucudur.</p>
    </details>
  );
}

function MsaCriteriaCard() {
  const { project: p, edit } = useStore();
  const m: MsaCriteria = p.settings.msaCriteria ?? DEFAULT_MSA_CRITERIA;
  const setM = (patch: Partial<MsaCriteria>) => edit({ kind: 'settings', field: 'msaCriteria', value: { ...m, ...patch } }, 'MSA kabul kriteri');
  const crit = m.maxGrrPct != null || m.minNdc != null || m.minKappa != null;
  return (
    <details className="card">
      <summary><b>MSA kabul kriterleri</b> · {crit ? `GR&R ≤ ${m.maxGrrPct ?? '—'}% (${m.basis}), ndc ≥ ${m.minNdc ?? '—'}, kappa ≥ ${m.minKappa ?? '—'}` : 'Müşteri kriteri VERİ YOK'} · çözünürlük {m.resolutionRatio}:1 · TUR {m.tur}:1</summary>
      <div className="form">
        <NumField label="Müşteri GR&R üst limiti (%)" value={m.maxGrrPct} onCommit={(v) => setM({ maxGrrPct: v })} />
        <label>
          <span>Kriter bazı</span>
          <select className="cell-select" value={m.basis} onChange={(e) => setM({ basis: e.target.value as MsaCriteria['basis'] })}>
            <option value="%Tolerance">%Tolerance</option>
            <option value="%Study Var">%Study Var</option>
          </select>
        </label>
        <NumField label="Müşteri ndc alt limiti" value={m.minNdc} onCommit={(v) => setM({ minNdc: v })} />
        <NumField label="Müşteri kappa alt limiti (nitel)" value={m.minKappa} onCommit={(v) => setM({ minKappa: v })} />
        <NumField label="Çözünürlük oranı (MSA p30)" value={m.resolutionRatio} onCommit={(v) => (v == null ? Promise.resolve(false) : setM({ resolutionRatio: v }))} />
        <NumField label="TUR (MSA p17–19)" value={m.tur} onCommit={(v) => (v == null ? Promise.resolve(false) : setM({ tur: v }))} />
        <label><span>Kriter kaynağı (müşteri dokümanı)</span><TextCell value={m.source} onCommit={(v) => setM({ source: String(v) })} /></label>
      </div>
      <p className="muted small">SCMH MSA webinarı GR&R kabul limiti vermez (“Refer to your customer for criteria”, p36). Kriter girilmezse sonuç VERİ YOK olarak gösterilir.</p>
    </details>
  );
}

// ───────────────────────── Capability ─────────────────────────

export function CapabilityPanel({ id }: { id?: string }) {
  const { project: p, edit, toast } = useStore();
  const row = p.capability.find((c) => c.id === id);
  if (!row) return <aside className="card tree"><h3>Capability doğrulama</h3><p className="muted">Analiz için bir satır seçin. Veriyi “Ölçüm Verisi” sütununa yapıştırın.</p></aside>;
  const rc = rowCapability(row, p.settings);
  const a = rc.variable;
  const at = rc.attribute;
  const occ = occurrenceFromCapability(p, row);
  const prov = provenanceIssues(row);
  const blocker = msaBlocker(p, row);
  const pfs = linkedPfmea(p, row);
  const propose = async () => {
    const rec = capReactionEdits(p, row.id);
    if (!rec.length) return toast('Önerilecek yeni tepki yok.', 'warn');
    const edits: Edit[] = rec.map((r) => (r.kind === 'add' ? { kind: 'add', table: r.table, row: r.row! } : { kind: 'set', table: r.table, id: r.id, field: r.field!, value: r.value }));
    await edit(edits, `${row.id} AS9145 Tablo 1 tepkileri`);
  };
  const verdictBadge = rc.verdict === 'VALID' ? 'b-green' : rc.verdict === 'INVALID' ? 'b-red' : 'b-amber';
  return (
    <aside className="card tree">
      <h3>
        {row.id} · <span className={`badge ${verdictBadge}`}>{rc.verdict}</span>
        {rc.band && <> · <span className={`badge ${BAND_BADGE[rc.band]}`}>{rc.band} ({rc.indexName} {f(rc.index, 2)})</span></>}
        {rc.kind === 'Attribute' && <> · <span className="badge b-blue">NİTEL</span></>}
      </h3>
      {rc.band && <p className="small">{BAND_LABEL[rc.band]}</p>}
      {requiredReactions(rc.band).length > 0 && (
        <div className="callout small">
          <b>AS9145 Tablo 1 gereken tepkiler:</b>
          <ul className="plain">{requiredReactions(rc.band).map((x) => <li key={x}>{x}</li>)}</ul>
          <div>Containment: {row.containmentCpId || '—'} · Aksiyon: {row.actionId || '—'}{rc.band === 'REJECT' && <> · Müşteri konusu: {row.customerIssueId || '—'}</>}</div>
          <button className="btn" onClick={propose}>Tepkileri öner (AI SUGGESTION)</button>
        </div>
      )}
      {a && (
        <table className="effects small">
          <tbody>
            <tr><td>n / min</td><td>{a.n} / {a.minSamples}</td></tr>
            <tr><td>Alt grup / min</td><td>{a.subgroups} / {a.method === 'I-MR' ? '—' : a.minSubgroups}</td></tr>
            <tr><td>Kart</td><td>{a.method || '—'} <span className="muted">{a.chartWhy}</span></td></tr>
            {a.limits && <tr><td>Limitler</td><td>CL {f(a.limits.center, 4)} · UCL {f(a.limits.ucl, 4)} · LCL {f(a.limits.lcl, 4)} | {a.limits.dispLabel}: CL {f(a.limits.dispCenter, 4)} · UCL {f(a.limits.dispUcl, 4)}</td></tr>}
            <tr><td>Ortalama</td><td>{f(a.mean, 4)}</td></tr>
            <tr><td>σ within / overall</td><td>{f(a.sigmaWithin, 4)} / {f(a.sigmaOverall, 4)}</td></tr>
            <tr>
              <td>Cp / Cpk</td>
              <td>{f(a.cp)} / {f(a.cpk)} {guidelineColor('Cp', a.cp) && <span className={`badge ${GUIDE_BADGE[guidelineColor('Cp', a.cp)]}`} title="CAP p66 renk kılavuzu – kabul kriteri değildir">kılavuz</span>}</td>
            </tr>
            <tr>
              <td>Pp / Ppk</td>
              <td>{f(a.pp)} / {f(a.ppk)} {guidelineColor('Pp', a.pp) && <span className={`badge ${GUIDE_BADGE[guidelineColor('Pp', a.pp)]}`} title="CAP p66 renk kılavuzu – kabul kriteri değildir">kılavuz</span>}</td>
            </tr>
            <tr><td>Beklenen PPM within / overall</td><td>{ppm(a.ppmWithin)} / {ppm(a.ppmOverall)} · gözlenen {ppm(a.ppmObserved)}</td></tr>
            <tr><td>Z.bench / Sigma (~3×Cpk)</td><td>{f(a.zBench, 2)} / {f(a.sigmaLevel, 2)}</td></tr>
            <tr><td>Normallik (AD)</td><td>{a.ad == null ? '—' : `A²=${a.ad.toFixed(3)} p≈${f(a.adP)} → ${a.normal ? 'normal' : 'normal değil'}`}</td></tr>
            <tr><td>Kararlılık</td><td>{a.stable == null ? '—' : a.stable ? 'kontrol altında' : a.ruleHits.map((h) => `${h.rule}: ${h.points.slice(0, 10).join(', ')}`).join(' · ')}</td></tr>
          </tbody>
        </table>
      )}
      {at && (
        <table className="effects small">
          <tbody>
            <tr><td>Tip / kart</td><td>{at.kind} · {at.chart} <span className="muted">{at.chartWhy}</span></td></tr>
            <tr><td>Kusur / adet</td><td>{at.defects} / {at.units}</td></tr>
            <tr><td>Alt grup / min</td><td>{at.subgroups} / {at.minSubgroups}</td></tr>
            <tr><td>Oran</td><td>{at.rate == null ? '—' : `${(at.rate * 100).toFixed(3)}%`}</td></tr>
            <tr><td>PPM / DPMO</td><td>{ppm(at.ppm)} / {ppm(at.dpmo)}</td></tr>
            <tr><td>Z eşdeğeri (uzun dönem)</td><td>{f(at.zEquivalent, 2)}</td></tr>
            <tr><td>Kararlılık</td><td>{at.stable == null ? '—' : at.stable ? 'kontrol altında' : `kontrol dışı alt grup: ${at.outOfControl.join(', ')}`}</td></tr>
          </tbody>
        </table>
      )}
      <p className="small"><b>Occurrence önerisi (CAP p50):</b> {occ.rank != null ? `O = ${occ.rank} · ${occ.evidence}` : occ.note} {occ.rank != null && occ.note && <span className="muted">{occ.note}</span>}</p>
      {pfs.length > 0 && <p className="small muted">Bağlı PFMEA: {pfs.map((x) => `${x.id} (O=${x.o ?? '—'})`).join(', ')} – O’yu mühendis değiştirir.</p>}
      {blocker && <p className="small"><span className="badge b-amber">MSA</span> {blocker}</p>}
      {prov.length > 0 && <ul className="plain small">{prov.map((x) => <li key={x}>⚠ {x}</li>)}</ul>}
      {(a?.reasons ?? at?.reasons ?? []).length > 0 && <ul className="plain small">{(a?.reasons ?? at?.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>}
    </aside>
  );
}

export function CapabilityScreen() {
  const { project, edit, toast } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const fromKc = async () => {
    const b = addBatch(project);
    for (const k of project.kcs.filter((k) => k.status !== 'Rejected' && !project.capability.some((c) => c.kcId === k.id))) b.add('capability', { kcId: k.id, characteristic: k.characteristic } as Partial<AnyRow>);
    if (!b.edits.length) return toast('Tüm KC’lerin capability kaydı var.', 'warn');
    await edit(b.edits, 'KC’lerden capability');
  };
  return (
    <div className="split">
        <Grid
          table="capability"
          selected={sel}
          onSelect={setSel}
          toolbar={<button className="btn" onClick={fromKc}>KC’lerden oluştur</button>}
          emptyHint="Veri yoksa: “Capability calculation cannot be performed – production data required.”"
        />
        <div style={{ overflow: 'auto', minHeight: 0 }}>
          <CapCriteriaCard />
          <CapabilityPanel id={sel[0]} />
        </div>
    </div>
  );
}

// ───────────────────────── MSA ─────────────────────────

export function MsaPanel({ id }: { id?: string }) {
  const { project: p } = useStore();
  const row = p.msa.find((m) => m.id === id);
  if (!row)
    return (
      <aside className="card tree">
        <h3>Ölçüm sistemi seçimi</h3>
        <p className="muted small">Bir MSA satırı seçin. Akış (MSA webinar p11–13): 1) özellik ve tolerans 2) çözünürlük ≥10:1 3) belirsizlik / TUR ≥4:1 4) doğruluk, doğrusallık, kararlılık 5–6) aynı/benzer kararlı sistem varsa referans 7A) yazılım analizi 7B) çoklu cihaz → belirsizlik analizi 10) GR&R (≥5 parça, ≥2 operatör) 11–12) doğrula ve belgele.</p>
      </aside>
    );
  const ev = evaluateMsa(row, p);
  const steps: [string, string, boolean | null][] = [
    ['1. Tolerans', ev.tolerance == null ? 'VERİ YOK' : `${ev.tolerance} (${ev.toleranceFrom})`, ev.tolerance != null],
    ['2. Çözünürlük', ev.resolutionRatio == null ? 'VERİ YOK' : `${ev.resolutionRatio.toFixed(1)}:1`, ev.resolutionRatio == null ? null : ev.resolutionRatio >= p.settings.msaCriteria.resolutionRatio],
    ['3. TUR', ev.tur == null ? 'VERİ YOK' : `${ev.tur.toFixed(1)}:1`, ev.tur == null ? null : ev.tur >= p.settings.msaCriteria.tur],
    ['4. Kararlılık / doğrusallık', `${ev.stabilityOk == null ? 'kararlılık VERİ YOK' : ev.stabilityOk ? 'kararlılık OK' : 'kararlılık NOK'} · doğrusallık ${row.linearity || 'VERİ YOK'}`, ev.stabilityOk === false || row.linearity === 'NOK' ? false : ev.stabilityOk && row.linearity === 'OK' ? true : null],
    ['10. GR&R tasarımı', `${row.grrOperators ?? '—'} operatör × ${row.grrParts ?? '—'} parça × ${row.grrTrials ?? '—'} tekrar`, row.grrParts == null ? null : row.grrParts >= 5 && (row.grrOperators ?? 0) >= 2],
    ['11. Sonuç', `%GRR SV ${row.pctStudyVar ?? '—'} · Tol ${row.pctTolerance ?? '—'} · ndc ${row.ndc ?? '—'}${row.kappa != null ? ` · kappa ${row.kappa}` : ''}`, null],
  ];
  return (
    <aside className="card tree">
      <h3>{row.id} · <span className="badge b-blue">{row.status || '—'}</span></h3>
      <table className="effects small">
        <tbody>
          {steps.map(([k, v, ok]) => (
            <tr key={k}><td>{k}</td><td>{ok === false ? '⚠ ' : ok ? '✓ ' : ''}{v}</td></tr>
          ))}
          <tr><td>Kabul kriteri</td><td>{ev.criterionText}</td></tr>
          <tr><td>Değerlendirme</td><td>{ev.verdict || '—'}</td></tr>
        </tbody>
      </table>
      {ev.flow.length > 0 && <ul className="plain small">{ev.flow.map((x) => <li key={x}>→ {x}</li>)}</ul>}
      {ev.warnings.length > 0 && <ul className="plain small">{ev.warnings.map((x) => <li key={x}><span className="badge b-amber">ENGINEERING WARNING</span> {x}</li>)}</ul>}
      {row.reassess && <p className="small"><span className="badge b-amber">Yeniden çalışma</span> {row.reassess}</p>}
      <p className="muted small">“Not acceptable” seçildiğinde iyileştirme aksiyonu ve bağlı PFMEA satırlarında D yeniden değerlendirmesi önerilir. Durumu mühendis belirler.</p>
    </aside>
  );
}

export function MsaScreen() {
  const { project, edit, toast } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const fromCp = async () => {
    const b = addBatch(project);
    for (const c of project.controlPlan.filter((c) => needsMsa(c) && !msaCovers(project, c)))
      b.add('msa', { cpId: c.id, kcId: c.kcId, characteristic: c.productChar || c.processChar, gauge: c.gauge || c.method, ...msaStudyFor(c.method || c.gauge), status: 'Planned', trigger: c.kcId ? 'KC' : 'Control plan addition', notes: 'Çalışma tipi ölçüm yöntemine göre önerildi (AI SUGGESTION); mühendis doğrulamalı. Tüm ölçüm tipleri MSA gerektirir (MSA p26).' } as Partial<AnyRow>);
    if (!b.edits.length) return toast('Yeni MSA ihtiyacı bulunamadı.', 'warn');
    await edit(b.edits, 'Kontrol planından MSA');
  };
  return (
    <div className="split">
        <Grid
          table="msa"
          selected={sel}
          onSelect={setSel}
          toolbar={<button className="btn" onClick={fromCp}>Kontrol planından oluştur</button>}
          emptyHint="Kontrol planındaki her ölçüm (değişken ve nitel: görsel, go/no-go) için MSA planlayın."
        />
        <div style={{ overflow: 'auto', minHeight: 0 }}>
          <MsaCriteriaCard />
          <MsaPanel id={sel[0]} />
        </div>
    </div>
  );
}
