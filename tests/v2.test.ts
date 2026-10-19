import { describe, expect, it } from 'vitest';
import { auditEntries, needsReason, withAudit } from '../src/shared/audit';
import { appendBaseline, baselineProject, createBaseline, diffProjects, verifyBaseline } from '../src/shared/baseline';
import { andersonDarling, capabilityAnalysis } from '../src/shared/capability';
import { chunkDoc, findRequirementCandidates, parseValueSpec, retrieve, verifySource, type ExtractedDoc } from '../src/shared/docmodel';
import { planEdits, suggestMsaStudy } from '../src/shared/engine';
import { impactOf, originOf } from '../src/shared/impact';
import { evaluateKc } from '../src/shared/kc';
import { blankRow, newProject } from '../src/shared/model';
import { qualityReport, whatDidIMiss } from '../src/shared/quality';
import { actionPriority, AIAG_VDA_AP } from '../src/shared/scoring';
import { semanticFindings } from '../src/shared/semantic';
import { sampleProject as buildSampleProject } from '../src/shared/sample';
import { similarity } from '../src/shared/similarity';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';
import { currentStep, decisionError, recordDecision } from '../src/shared/workflow';

const doc = (blocks: ExtractedDoc['blocks']): ExtractedDoc => ({
  fileName: 'spec.docx', ext: 'docx', hash: 'abcdef0123456789', size: 1, parser: 'docx', status: 'ok', messages: [], meta: {}, blocks, extractedAt: '',
});

describe('AP / RPN', () => {
  it('uses company AP table when provided, else AIAG-VDA', () => {
    expect(actionPriority(7, 4, 4)).toBe('M');
    const table = { ...AIAG_VDA_AP, '4,3': 'HHHH' };
    expect(actionPriority(7, 4, 4, table)).toBe('H');
    // bozuk satır → AIAG-VDA'ya düşer
    expect(actionPriority(7, 4, 4, { '4,3': 'XX' })).toBe('M');
  });
});

describe('capability validation', () => {
  // Deterministik normal veri: normal dağılım yüzdelikleri, sabit permütasyonla sıralanmış (ort. 6.05, σ 0.008)
  const z = (q: number) => {
    // Beasley-Springer-Moro ters normal yaklaşımı
    const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
    const b = [-8.4736510929, 23.08336743743, -21.06224101826, 3.13082909833];
    const c = [0.337475482272615, 0.976169019091719, 0.160797971491821, 0.0276438810333863, 0.0038405729373609, 0.0003951896511919, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
    const y = q - 0.5;
    if (Math.abs(y) < 0.42) {
      const r = y * y;
      return (y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0])) / ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1);
    }
    let r = q > 0.5 ? 1 - q : q;
    r = Math.log(-Math.log(r));
    let x = c[0];
    for (let i = 1; i < 9; i++) x += c[i] * r ** i;
    return q < 0.5 ? -x : x;
  };
  const N = 50;
  const normal = Array.from({ length: N }, (_, i) => 6.05 + 0.008 * z(((i * 17) % N + 0.5) / N));
  it('insufficient data below minimum sample', () => {
    const a = capabilityAnalysis(normal.slice(0, 10), 6.0, 6.1, null, { minSamples: 25, targetCpk: 1.33 });
    expect(a.verdict).toBe('INSUFFICIENT DATA');
  });
  it('valid for stable normal data', () => {
    const a = capabilityAnalysis(normal, 6.0, 6.1, null, { minSamples: 25, targetCpk: 1.33 });
    expect(a.normal).toBe(true);
    expect(a.stable).toBe(true);
    expect(a.verdict).toBe('VALID');
    expect(a.cpk).not.toBeNull();
  });
  it('invalid when unstable', () => {
    const shifted = [...normal.slice(0, 15), 6.2, 6.21, 6.2, 6.22, 6.21, 6.2, 6.21, 6.2, 6.22, 6.21, 6.2];
    const a = capabilityAnalysis(shifted, 6.0, 6.3, null, { minSamples: 25, targetCpk: 1.33 });
    expect(a.stable).toBe(false);
    expect(a.verdict).toBe('INVALID');
  });
  it('unilateral tolerance has no Cp', () => {
    const a = capabilityAnalysis(normal, null, 6.1, null, { minSamples: 25, targetCpk: null });
    expect(a.unilateral).toBe(true);
    expect(a.cp).toBeNull();
    expect(a.cpk).not.toBeNull();
  });
  it('anderson-darling rejects strongly skewed data', () => {
    const skew = Array.from({ length: 40 }, (_, i) => Math.exp(i / 6));
    expect(andersonDarling(skew)!.p).toBeLessThan(0.05);
  });
});

describe('document model', () => {
  it('parses value specs without inventing values', () => {
    expect(parseValueSpec('Thickness shall be 2.00 ± 0.10 mm')).toMatchObject({ nominal: 2, lsl: 1.9, usl: 2.1, unit: 'mm' });
    expect(parseValueSpec('Ø6.00 +0.10/-0.00')).toMatchObject({ nominal: 6, lsl: 6, usl: 6.1 });
    expect(parseValueSpec('Cure at 120–130 °C')).toMatchObject({ lsl: 120, usl: 130, unit: '°C' });
    expect(parseValueSpec('Lap shear min. 25 MPa')).toMatchObject({ lsl: 25, usl: null, unit: 'MPa' });
    expect(parseValueSpec('The part shall be painted')).toBeNull();
  });
  it('finds requirement candidates with location', () => {
    const d = doc([
      { id: 'b1', kind: 'heading', text: '3.2 Dimensions', loc: { page: 2, section: '3.2' } },
      { id: 'b2', kind: 'paragraph', text: 'The skin thickness shall be 2.00 ± 0.10 mm.', loc: { page: 2, section: '3.2' } },
      { id: 'b3', kind: 'paragraph', text: 'General description of the radome.', loc: { page: 2 } },
    ]);
    const c = findRequirementCandidates(d);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ lsl: 1.9, usl: 2.1, reqType: 'Dimensional', confidence: 'High', loc: { section: '3.2' } });
  });
  it('verifies sources and flags fabricated quotes', () => {
    const d = doc([{ id: 'b1', kind: 'paragraph', text: 'Bondline thickness shall be 0.20 – 0.40 mm.', loc: { page: 4 } }]);
    expect(verifySource(d, 'bondline thickness shall be 0.20 – 0.40 mm', { page: 4 }).verdict).toBe('VERIFIED');
    expect(verifySource(d, 'Bondline thickness shall be 0.20 – 0.40 mm', { page: 9 }).verdict).toBe('VERIFIED – farklı konum');
    expect(verifySource(d, 'Bondline thickness shall be 0.30 mm max').verdict).toBe('SOURCE NOT VERIFIED');
    expect(verifySource(undefined, 'x').verdict).toBe('SOURCE NOT VERIFIED');
    expect(verifySource(doc([]), 'x').verdict).toBe('MANUAL VERIFICATION REQUIRED');
  });
  it('chunks and retrieves relevant parts', () => {
    const blocks = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, kind: 'paragraph' as const, text: i === 42 ? 'Autoclave cure temperature shall be 180 °C' : `Filler paragraph number ${i} about packaging and labels`, loc: { page: i } }));
    const ch = chunkDoc(doc(blocks), 200);
    expect(ch.length).toBeGreaterThan(3);
    expect(retrieve(ch, 'cure temperature autoclave', 1)[0].text).toContain('Autoclave cure');
  });
});

function sample(): Project {
  return buildSampleProject();
}

describe('KC engine', () => {
  it('lists factors and never approves', () => {
    const p = sample();
    const df = p.dfmea[0];
    const ev = evaluateKc(p, { ...df, s: 9, d: 8 });
    expect(ev.factors.find((f) => f.key === 'severity')!.on).toBe(true);
    expect(ev.factors.find((f) => f.key === 'detection')!.on).toBe(true);
    expect(ev.summary).toMatch(/AI SUGGESTION/);
  });
  it('high severity alone is not proposed as Critical', () => {
    const p = newProject();
    const r = { ...(blankRow('dfmea', 'DF-001') as DfmeaRow), failureMode: 'x', s: 10, d: 2 };
    p.dfmea.push(r);
    expect(evaluateKc(p, r).suggestedCategory).toBe('Significant');
  });
});

describe('semantic validator', () => {
  it('detects FMEA logic errors and operator-error root cause', () => {
    const p = newProject();
    p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), failureMode: 'Müşteri şikayeti', effect: 'Müşteri şikayeti', cause: 'Operatör hatası', s: 7 });
    const f = semanticFindings(p);
    expect(f.some((x) => x.code === 'fm-eq-effect' && x.kind === 'FMEA LOGIC ERROR')).toBe(true);
    expect(f.some((x) => x.code === 'fm-is-effect')).toBe(true);
    expect(f.some((x) => x.code === 'cause-operator' && /Root cause may be insufficiently defined/.test(x.message))).toBe(true);
  });
});

describe('quality score', () => {
  it('produces a 0–100 score with 7 dimensions', () => {
    const r = qualityReport(sample());
    expect(r.dimensions).toHaveLength(7);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.label).toMatch(/^FMEA Quality Score: \d+\/100$/);
  });
  it('what did I miss lists gaps', () => {
    const items = whatDidIMiss(sample());
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('traceability graph', () => {
  it('impact and origin chains', () => {
    const p = sample();
    const req = p.dfmea[0].reqIds[0];
    const imp = impactOf(p, [req]);
    expect(imp.ids).toContain(p.dfmea[0].id);
    const pf = p.pfmea.find((x) => x.dfIds.includes(p.dfmea[0].id));
    if (pf) expect(imp.ids).toContain(pf.id);
    expect(originOf(p, p.dfmea[0].id).some((s) => s.id === req)).toBe(true);
  });
});

describe('baseline', () => {
  it('is sealed and tamper-evident', () => {
    const p = sample();
    const b = createBaseline(p, { revision: 'Rev A', author: 'Kemal', approver: 'QA', approvalComment: 'ok', changeReason: 'İlk baseline' });
    expect(verifyBaseline(b)).toBe(true);
    expect(verifyBaseline({ ...b, snapshot: b.snapshot.replace('"s":7', '"s":3') })).toBe(false);
    const p2 = appendBaseline(p, b);
    expect(p2.baselines).toHaveLength(1);
    const changed = planEdits(p2, [{ kind: 'set', table: 'dfmea', id: p2.dfmea[0].id, field: 'cause', value: 'yeni' }]).project;
    const d = diffProjects(baselineProject(b), changed);
    expect(d.some((x) => x.kind === 'Modified' && x.fields.some((f) => f.field === 'cause'))).toBe(true);
    expect(changed.baselines[0]).toEqual(b);
    expect(verifyBaseline(changed.baselines[0])).toBe(true);
  });
});

describe('workflow and audit', () => {
  it('requires a user and follows steps in order', () => {
    let p = sample();
    expect(currentStep(p)).toBe('Engineer Review');
    expect(decisionError(p, { step: 'Engineer Review', decision: 'Approved', user: '', role: '', comment: '' }, 0)).toMatch(/kullanıcı adı/);
    expect(decisionError(p, { step: 'Quality Review', decision: 'Approved', user: 'K', role: '', comment: '' }, 0)).toMatch(/Sıradaki adım/);
    p = recordDecision(p, { step: 'Engineer Review', decision: 'Approved', user: 'K', role: 'Design Engineer', comment: '' });
    expect(currentStep(p)).toBe('Design Review');
    p = recordDecision(p, { step: 'Design Review', decision: 'Returned', user: 'K', role: 'Design Engineer', comment: 'eksik' });
    expect(currentStep(p)).toBe('Engineer Review');
    expect(decisionError(p, { step: 'Final Approval', decision: 'Approved', user: 'K', role: '', comment: '' }, 2)).toBeTruthy();
  });
  it('records old/new values with reason', () => {
    const p = sample();
    const id = p.dfmea[0].id;
    const plan = planEdits(p, [{ kind: 'set', table: 'dfmea', id, field: 's', value: 9 }]);
    expect(needsReason(p, plan.effects)).toBe(true);
    const e = auditEntries(plan.project, plan.effects, { user: 'Kemal', reason: 'Müşteri değişikliği' });
    const main = e.find((x) => x.id === id && x.field === 's')!;
    expect(main).toMatchObject({ user: 'Kemal', from: 7, to: 9, reason: 'Müşteri değişikliği' });
    expect(withAudit(plan.project, e).auditLog.length).toBe(e.length);
  });
});

describe('misc', () => {
  it('MSA suggestion does not default to GR&R', () => {
    expect(suggestMsaStudy('Tapa mastar').study).toBe('Attribute Agreement Analysis');
    expect(suggestMsaStudy('CMM').study).toBe('Gage R&R');
    expect(suggestMsaStudy('VERİ YOK – doğrulanmalı').study).toBe('');
  });
  it('similarity', () => {
    expect(similarity('incorrect adhesive thickness bondline', 'bondline adhesive thickness too high')).toBeGreaterThan(0.5);
  });
});
