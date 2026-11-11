// v4-cap: capability bantları (AS9145 Tablo 1), istatistik genişliği, MSA yapılandırması ve motor kuralları.
import { describe, expect, it } from 'vitest';
import { attributeCapability, c4, capabilityAnalysis, invPhi, runRules } from '../src/shared/capability';
import { bandOf, capResultText, guidelineColor, isPpapCapabilityEvidence, occurrenceFromCapability, provenanceIssues, rowCapability } from '../src/shared/capBand';
import { capChecks } from '../src/shared/capChecks';
import { capReactionEdits } from '../src/shared/capEngine';
import { planEdits, type Edit } from '../src/shared/engine';
import { blankRow, newProject, normalizeProject, DEFAULT_SETTINGS } from '../src/shared/model';
import { evaluateMsa, toleranceFromSpec } from '../src/shared/msa';
import { qualityChecks } from '../src/shared/checks';
import { validateTemplate, makeTemplate } from '../src/shared/template';
import type { CapabilityRow, ControlPlanRow, KcRow, MsaRow, PfmeaRow, Project } from '../src/shared/types';

// Belirlenimci "normal" veri: ters normal kantilleri karıştırılmış sırada
const qnorm = (N: number, mean: number, sd: number, step = 17) => Array.from({ length: N }, (_, i) => mean + sd * invPhi((((i * step) % N) + 0.5) / N));
const S = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, minSamples: 25, ...over });

function seed(): Project {
  const p = newProject();
  p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), stepId: 'OP-001', opNo: '60', stepName: 'Machining', failureMode: 'Hole oversize', s: 8, o: 3, d: 4, measurement: 'Bore gauge BG-12', detection: 'Bore gauge BG-12' });
  p.kcs.push({ ...(blankRow('kcs', 'KC-001') as KcRow), sourceId: 'PF-001', characteristic: 'Delik çapı', status: 'Approved' });
  p.controlPlan.push({ ...(blankRow('controlPlan', 'CP-001') as ControlPlanRow), kcId: 'KC-001', pfId: 'PF-001', productChar: 'Delik çapı', specification: '6.00–6.10', method: 'Bore gauge', gauge: 'BG-12', sampleSize: '5', frequency: '1/saat' });
  p.msa.push({ ...(blankRow('msa', 'MSA-001') as MsaRow), cpId: 'CP-001', kcId: 'KC-001', gauge: 'BG-12', study: 'Gage R&R', status: 'Planned' });
  p.capability.push({ ...(blankRow('capability', 'CAP-001') as CapabilityRow), kcId: 'KC-001', characteristic: 'Delik çapı' });
  return p;
}

/** Cpk ≈ hedef olacak simetrik LSL/USL. */
function limitsFor(values: number[], cpk: number, k?: number) {
  const a = capabilityAnalysis(values, 0, 1e9, null, S(), k);
  const m = a.mean!, sw = a.sigmaWithin!;
  return { lsl: m - 3 * sw * cpk, usl: m + 3 * sw * cpk };
}
const data = qnorm(50, 6.05, 0.008);
const setData = (cpk: number): Edit[] => {
  const { lsl, usl } = limitsFor(data, cpk);
  return [
    { kind: 'set', table: 'capability', id: 'CAP-001', field: 'lsl', value: lsl },
    { kind: 'set', table: 'capability', id: 'CAP-001', field: 'usl', value: usl },
    { kind: 'set', table: 'capability', id: 'CAP-001', field: 'data', value: data.join(' ') },
  ];
};

describe('statistics breadth (CAP webinar)', () => {
  it('c4 and inverse normal constants', () => {
    expect(c4(5)).toBeCloseTo(0.94, 3);
    expect(c4(12)).toBeCloseTo(0.9776, 3);
    expect(invPhi(0.99865)).toBeCloseTo(3, 2);
  });
  it('uses Xbar-s for subgroups larger than 10 and Xbar-R up to 10', () => {
    const v = qnorm(12 * 25, 10, 0.1);
    const s = capabilityAnalysis(v, 9.5, 10.5, null, S(), 12);
    expect(s.method).toBe('Xbar-s');
    expect(s.limits?.dispLabel).toBe('s');
    expect(s.subgroups).toBe(25);
    const r = capabilityAnalysis(qnorm(250, 10, 0.1), 9.5, 10.5, null, S(), 10);
    expect(r.method).toBe('Xbar-R');
    expect(r.limits?.dispLabel).toBe('R');
  });
  it('counts the minimum in subgroups (20–25, CAP p38)', () => {
    const v = qnorm(50, 10, 0.1);
    const a = capabilityAnalysis(v, 9.5, 10.5, null, S(), 5);
    expect(a.subgroups).toBe(10);
    expect(a.verdict).toBe('INSUFFICIENT DATA');
    expect(a.reasons.join(' ')).toMatch(/Alt grup sayısı \(10\)/);
    expect(a.reasons.join(' ')).toMatch(/müşteriye danışın/);
    const b = capabilityAnalysis(qnorm(125, 10, 0.1, 37), 9.5, 10.5, null, S(), 5);
    expect(b.subgroups).toBe(25);
    expect(b.verdict).toBe('VALID');
  });
  it('checks the R chart: a wide subgroup with an unchanged mean is out of control', () => {
    const v = qnorm(125, 10, 0.1, 37);
    for (const [i, d] of [[50, -0.6], [51, 0.6], [52, -0.6], [53, 0.6]] as const) v[i] = 10 + d;
    const a = capabilityAnalysis(v, 8, 12, null, S(), 5);
    expect(a.dispersionOoc).toContain(11);
    expect(a.stable).toBe(false);
    expect(a.verdict).toBe('INVALID');
  });
  it('detects a 6-point trend', () => {
    const hits = runRules([1, 2, 1, 2, 3, 4, 5, 6, 7, 2], 3, 100, -100);
    expect(hits.some((h) => /trend/.test(h.rule))).toBe(true);
  });
  it('reports expected PPM, Z.bench and sigma level', () => {
    const { lsl, usl } = limitsFor(data, 1.0);
    const a = capabilityAnalysis(data, lsl, usl, null, S());
    expect(a.cpk).toBeCloseTo(1.0, 2);
    expect(a.ppmWithin).toBeGreaterThan(2000);
    expect(a.ppmWithin).toBeLessThan(3500);
    expect(a.sigmaLevel).toBeCloseTo(3 * a.cpk!, 6);
    expect(a.zBench).not.toBeNull();
  });
  it('attribute capability is labelled and uses p/np/c/u', () => {
    const at = attributeCapability({ kind: 'Defectives', data: Array(25).fill('1/50').join(' '), defects: null, units: null, opportunities: null }, {});
    expect(at.chart).toBe('np');
    expect(at.ppm).toBeCloseTo(20000, 6);
    expect(at.verdict).toBe('VALID');
    expect(at.reasons.join(' ')).toMatch(/Cpk\/Ppk değildir/);
    const u = attributeCapability({ kind: 'Defects', data: '', defects: 4, units: 100, opportunities: 10 }, {});
    expect(u.dpmo).toBeCloseTo(4000, 6);
    expect(u.verdict).toBe('INSUFFICIENT DATA');
    const row = { ...(blankRow('capability', 'CAP-009') as CapabilityRow), dataKind: 'Attribute' as const, attrKind: 'Defectives' as const, data: Array(25).fill('1/50').join(' ') };
    expect(capResultText(row, S())).toMatch(/NİTEL.*müşteri kriteri/);
    expect(rowCapability(row, S()).band).toBe('');
  });
});

describe('AS9145 Table 1 bands', () => {
  it('three bands with default and custom thresholds', () => {
    expect(bandOf(1.4, DEFAULT_SETTINGS)).toBe('ACCEPT');
    expect(bandOf(1.33, DEFAULT_SETTINGS)).toBe('ACCEPT');
    expect(bandOf(1.2, DEFAULT_SETTINGS)).toBe('CONDITIONAL');
    expect(bandOf(1.0, DEFAULT_SETTINGS)).toBe('CONDITIONAL');
    expect(bandOf(0.99, DEFAULT_SETTINGS)).toBe('REJECT');
    expect(bandOf(1.4, { capAcceptance: { accept: 1.67, conditional: 1.33, source: 'Müşteri' } })).toBe('CONDITIONAL');
    expect(bandOf(null, DEFAULT_SETTINGS)).toBe('');
  });
  it('verdict text shows VALID · CONDITIONAL (Cpk x)', () => {
    const p = planEdits(seed(), setData(1.15), false).project;
    expect(capResultText(p.capability[0], p.settings)).toMatch(/^VALID · CONDITIONAL \(Cpk 1\.1\d\)$/);
  });
  it('CAP p66 colour guideline is separate from the band', () => {
    expect(guidelineColor('Cp', 1.5)).toBe('yellow');
    expect(guidelineColor('Cp', 1.7)).toBe('green');
    expect(guidelineColor('Pp', 1.2)).toBe('yellow');
    expect(guidelineColor('Pp', 0.9)).toBe('red');
  });
});

describe('engine: capability reactions are proposals', () => {
  it('CONDITIONAL proposes a 100% containment CP row and a corrective action', () => {
    const plan = planEdits(seed(), setData(1.15));
    const p = plan.project;
    const cap = p.capability[0];
    const cont = p.controlPlan.find((c) => c.capId === 'CAP-001')!;
    expect(cont).toBeTruthy();
    expect(cont.sampleSize).toBe('%100');
    expect(cont.autoCreated).toBe(true);
    expect(cont.notes).toMatch(/AI SUGGESTION/);
    expect(cap.containmentCpId).toBe(cont.id);
    const act = p.actions.find((a) => a.id === cap.actionId)!;
    expect(act.sourceId).toBe('CAP-001');
    expect(act.status).toBe('Open');
    expect(cap.customerIssueId).toBe('');
    expect(p.issues.length).toBe(0);
    // önerilen satırlar onay penceresinde listelenir
    expect(plan.effects.some((e) => e.table === 'controlPlan' && e.kind === 'Added' && !e.primary)).toBe(true);
    // containment satırı ayrı MSA önermez (aynı ölçüm)
    expect(p.msa.length).toBe(1);
  });
  it('REJECT also opens a Critical customer-contact issue; re-running does not duplicate', () => {
    let p = planEdits(seed(), setData(0.8)).project;
    const cap = p.capability[0];
    const is = p.issues.find((i) => i.id === cap.customerIssueId)!;
    expect(is.priority).toBe('Critical');
    expect(is.description).toMatch(/müşteri temsilcisi/i);
    expect(is.relatedFmea).toBe('PF-001');
    p = planEdits(p, [{ kind: 'set', table: 'capability', id: 'CAP-001', field: 'target', value: 6.05 }]).project;
    expect(p.issues.length).toBe(1);
    expect(p.controlPlan.filter((c) => c.capId).length).toBe(1);
    expect(p.actions.length).toBe(1);
  });
  it('ACCEPT proposes removing the auto containment row', () => {
    let p = planEdits(seed(), setData(1.15)).project;
    const contId = p.capability[0].containmentCpId;
    p = planEdits(p, setData(1.6)).project;
    expect(p.controlPlan.some((c) => c.id === contId)).toBe(false);
    expect(p.capability[0].containmentCpId).toBe('');
  });
  it('"only this screen" applies no proposals', () => {
    const p = planEdits(seed(), setData(0.8), false).project;
    expect(p.controlPlan.length).toBe(1);
    expect(p.actions.length).toBe(0);
  });
  it('capReactionEdits builds edits for existing rows that go through planEdits', () => {
    const base = planEdits(seed(), setData(0.8), false).project;
    const rec = capReactionEdits(base, 'CAP-001');
    expect(rec.filter((r) => r.kind === 'add').map((r) => r.table).sort()).toEqual(['actions', 'controlPlan', 'issues']);
    const edits: Edit[] = rec.map((r) => (r.kind === 'add' ? { kind: 'add', table: r.table, row: r.row! } : { kind: 'set', table: r.table, id: r.id, field: r.field!, value: r.value }));
    const p = planEdits(base, edits).project;
    expect(p.capability[0].customerIssueId).toBe(p.issues[0].id);
    expect(p.controlPlan.find((c) => c.id === p.capability[0].containmentCpId)?.capId).toBe('CAP-001');
  });
  it('VALID capability proposes O evidence, reassess and frozen SPC limits; O itself is not changed', () => {
    const p = planEdits(seed(), setData(1.5)).project;
    const pf = p.pfmea[0];
    expect(pf.o).toBe(3);
    expect(pf.oEvidence).toMatch(/^CAP-001: Cpk 1\.5\d \(PPM/);
    expect(pf.reassess).toMatch(/O önerisi/);
    const cp = p.controlPlan[0];
    expect(cp.spcChart).toBe('I-MR');
    expect(cp.spcUcl).not.toBeNull();
    expect(cp.spcBaselineCapId).toBe('CAP-001');
    expect(cp.spcLimitsFixedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('deleting the capability row removes its auto containment row', () => {
    let p = planEdits(seed(), setData(0.8)).project;
    p = planEdits(p, [{ kind: 'delete', table: 'capability', id: 'CAP-001' }]).project;
    expect(p.controlPlan.some((c) => c.capId)).toBe(false);
  });
});

describe('capability → occurrence (CAP p50)', () => {
  it('maps PPM to the SCMH P-OCC "% of production" rows (conservative)', () => {
    const p = planEdits(seed(), setData(0.95), false).project;
    const s = occurrenceFromCapability(p, p.capability[0]);
    // P-OCC: 10%→7, 5%→6, 0.5%→5, 0.1%→4, 0.05%→3, 0.01%→2; oran, karşılayan en küçük yüzdeye eşlenir
    const pct = s.ppm! / 1e4;
    const expected = [[0.01, 2], [0.05, 3], [0.1, 4], [0.5, 5], [5, 6], [10, 7]].find(([t]) => t >= pct)![1];
    expect(s.rank).toBe(expected);
    expect(s.evidence).toMatch(/^CAP-001: Cpk 0\.9\d \(PPM \d+\)$/);
  });
  it('is VERİ YOK when the O table has no production-rate mapping', () => {
    const p0 = seed();
    p0.settings.scoringStandard = 'AIAG-VDA';
    p0.scoring.occurrence = p0.scoring.occurrence.map((e) => ({ ...e, pf: 'Önleyici kontroller etkili' }));
    const p = planEdits(p0, setData(1.5), false).project;
    const s = occurrenceFromCapability(p, p.capability[0]);
    expect(s.rank).toBeNull();
    expect(s.note).toMatch(/VERİ YOK/);
  });
  it('warns when O ≤ 3 but the band is not ACCEPT', () => {
    const p = planEdits(seed(), setData(1.15), false).project;
    const c = capChecks(p).find((x) => x.key === 'cap-o')!;
    expect(c.ok).toBe(false);
    expect(c.ids).toContain('PF-001');
  });
});

describe('MSA', () => {
  const S2 = newProject();
  const row = (over: Partial<MsaRow>) => ({ ...(blankRow('msa', 'MSA-100') as MsaRow), ...over });
  it('parses tolerance from the CP spec', () => {
    expect(toleranceFromSpec('Ø6.00–6.10')).toBeCloseTo(0.1, 9);
    expect(toleranceFromSpec('10 ±0.2 mm')).toBeCloseTo(0.4, 9);
    expect(toleranceFromSpec('VERİ YOK – doğrulanmalı')).toBeNull();
  });
  it('flags resolution < 10:1, TUR < 4:1, parts < 5, operators < 2', () => {
    const ev = evaluateMsa(row({ tolerance: 0.1, resolution: 0.02, gaugeUncertainty: 0.02, grrParts: 3, grrOperators: 1, grrTrials: 2, study: 'Gage R&R' }), S2);
    expect(ev.resolutionRatio).toBeCloseTo(5, 6);
    expect(ev.tur).toBeCloseTo(2.5, 6);
    const w = ev.warnings.join(' | ');
    expect(w).toMatch(/Çözünürlük oranı 5:1 < 10:1/);
    expect(w).toMatch(/TUR 2\.5:1 < 4:1/);
    expect(w).toMatch(/parça sayısı 3 < 5/);
    expect(w).toMatch(/operatör sayısı 1 < 2/);
    expect(w).toMatch(/kalibrasyon doğrulanmalı/);
  });
  it('uses no invented GR&R limit: VERİ YOK without a customer criterion', () => {
    const ev = evaluateMsa(row({ study: 'Gage R&R', pctTolerance: 24, ndc: 4 }), S2);
    expect(ev.criterionText).toMatch(/VERİ YOK/);
    expect(ev.verdict).toBe('VERİ YOK – müşteri kriteri tanımlı değil');
  });
  it('applies the customer criterion from the row or settings', () => {
    const ev = evaluateMsa(row({ study: 'Gage R&R', pctTolerance: 24, custMaxGrr: 20, custSource: 'Müşteri QR-12 §4' }), S2);
    expect(ev.verdict).toBe('Kriteri karşılamıyor (öneri)');
    expect(ev.criterionText).toMatch(/QR-12/);
    const p = newProject();
    p.settings.msaCriteria = { ...p.settings.msaCriteria, maxGrrPct: 30, source: 'Müşteri' };
    expect(evaluateMsa(row({ study: 'Gage R&R', pctTolerance: 24 }), p).verdict).toBe('Kriteri karşılıyor (öneri)');
  });
  it('flow: software, multi-gauge and MSA by reference', () => {
    const p = newProject();
    p.msa.push(row({ id: 'MSA-001', status: 'Acceptable' }));
    const ev = evaluateMsa(row({ softwareDependent: true, multiGauge: true, refMsaId: 'MSA-001' }), p);
    expect(ev.flow.join(' ')).toMatch(/7A\/8.*7B\/9.*5–6/);
  });
  it('CP gauge change sets the MSA to re-study', () => {
    const p = planEdits(seed(), [{ kind: 'set', table: 'controlPlan', id: 'CP-001', field: 'gauge', value: 'CMM-3' }]).project;
    expect(p.msa[0].status).toBe('Planned (re-study)');
    expect(p.msa[0].trigger).toBe('Gauge change');
    expect(p.msa[0].reassess).toMatch(/BG-12 → CMM-3/);
  });
  it('a new non-KC CP measurement proposes an MSA row (every measurement type)', () => {
    const cp = { ...(blankRow('controlPlan', 'CP-002') as ControlPlanRow), processChar: 'Yüzey', method: 'Görsel muayene + limit numune' };
    const p = planEdits(seed(), [{ kind: 'add', table: 'controlPlan', row: cp }]).project;
    const m = p.msa.find((x) => x.cpId === 'CP-002')!;
    expect(m.study).toBe('Attribute Agreement Analysis');
    expect(m.trigger).toBe('Control plan addition');
    expect(m.origin).toBe('ai');
  });
  it('Not acceptable proposes an improvement action and D reassessment on the PFMEA row', () => {
    const p = planEdits(seed(), [{ kind: 'set', table: 'msa', id: 'MSA-001', field: 'status', value: 'Not acceptable' }]).project;
    const act = p.actions.find((a) => a.id === p.msa[0].actionId)!;
    expect(act.description).toMatch(/eğitim/);
    expect(p.pfmea[0].reassess).toMatch(/D \(tespit\)/);
    expect(p.pfmea[0].d).toBe(4);
  });
});

describe('quality checks (v4-cap)', () => {
  it('cp-cpk-100: KC without accepted capability needs 100% inspection (7.2.3 p85)', () => {
    const p = planEdits(seed(), setData(1.15), false).project;
    expect(capChecks(p).find((c) => c.key === 'cp-cpk-100')!.ok).toBe(false);
    const q = planEdits(seed(), setData(1.15)).project; // containment %100 satırı önerildi
    expect(capChecks(q).find((c) => c.key === 'cp-cpk-100')!.ok).toBe(true);
    expect(capChecks(q).find((c) => c.key === 'cap-customer')!.ok).toBe(true);
    expect(qualityChecks(q).some((c) => c.key === 'cap-band')).toBe(true);
  });
  it('msa-all and msa-result', () => {
    const p = seed();
    p.controlPlan.push({ ...(blankRow('controlPlan', 'CP-002') as ControlPlanRow), method: 'Kumpas', gauge: 'K-7' });
    p.msa[0].status = 'Acceptable';
    const c = capChecks(p);
    expect(c.find((x) => x.key === 'msa-all')!.ids).toEqual(['CP-002']);
    expect(c.find((x) => x.key === 'msa-result')!.ids).toEqual(['MSA-001']);
  });
  it('provenance: production run required for PPAP element 7', () => {
    const p = planEdits(seed(), setData(1.5), false).project;
    const cap = p.capability[0];
    expect(provenanceIssues(cap).join(' ')).toMatch(/Veri kaynağı/);
    expect(isPpapCapabilityEvidence(cap, p.settings)).toBe(false);
    expect(isPpapCapabilityEvidence({ ...cap, dataSource: 'Production run' }, p.settings)).toBe(true);
    expect(provenanceIssues({ ...cap, dataSource: 'Prototype', operators: '1' }).join(' ')).toMatch(/PPAP p26.*Tek operatör/);
  });
});

describe('migration and template (v4-cap)', () => {
  it('a V3 project without v4-cap fields opens with defaults', () => {
    const v3 = JSON.parse(JSON.stringify(seed()));
    for (const k of ['capAcceptance', 'minSubgroups', 'msaCriteria']) delete v3.settings[k];
    for (const r of v3.msa) for (const k of ['measType', 'grrParts', 'custMaxGrr', 'trigger', 'actionId', 'calibrationVerified']) delete r[k];
    for (const r of v3.capability) for (const k of ['dataKind', 'dataSource', 'containmentCpId', 'customerAccepted', 'term']) delete r[k];
    for (const r of v3.controlPlan) for (const k of ['capId', 'spcChart', 'spcUcl']) delete r[k];
    v3.settings.targetCpk = null;
    const notes: string[] = [];
    const p = normalizeProject(v3, { from: 0, to: 0, notes } as never);
    expect(p.settings.capAcceptance).toEqual({ accept: 1.33, conditional: 1.0, source: expect.stringMatching(/AS9145/) });
    expect(p.settings.minSubgroups).toBeNull();
    expect(p.settings.msaCriteria.maxGrrPct).toBeNull();
    expect(p.settings.msaCriteria.resolutionRatio).toBe(10);
    expect(p.settings.msaCriteria.tur).toBe(4);
    expect(p.msa[0].grrParts).toBeNull();
    expect(p.msa[0].measType).toBe('');
    expect(p.msa[0].calibrationVerified).toBe(false);
    expect(p.capability[0].dataKind).toBe('');
    expect(p.capability[0].customerAccepted).toBe(false);
    expect(p.controlPlan[0].spcUcl).toBeNull();
    expect(p.controlPlan[0].capId).toBe('');
    expect(p.msa[0].gauge).toBe('BG-12');
  });
  it('a V3 target Cpk is kept as the acceptance threshold', () => {
    const v3 = JSON.parse(JSON.stringify(seed()));
    delete v3.settings.capAcceptance;
    v3.settings.targetCpk = 1.67;
    const p = normalizeProject(v3);
    expect(p.settings.capAcceptance.accept).toBe(1.67);
    expect(p.settings.capAcceptance.conditional).toBe(1.0);
  });
  it('company template carries and validates the new settings', () => {
    const t = makeTemplate(newProject(), 'Şirket');
    expect(t.settings.capAcceptance?.accept).toBe(1.33);
    expect(validateTemplate(t)).toEqual([]);
    const bad = { ...t, settings: { ...t.settings, capAcceptance: { accept: 1.0, conditional: 1.33, source: '' } } };
    expect(validateTemplate(bad).join(' ')).toMatch(/capAcceptance/);
  });
});
