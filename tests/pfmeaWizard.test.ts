import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { pfmeaAreaOf } from '../src/shared/failureLib';
import { FLOW_TEMPLATES, planFlow } from '../src/shared/flowLib';
import { blankRow, newProject } from '../src/shared/model';
import { buildProposals } from '../src/shared/proposals';
import { PROCESS_GROUPS, wizardStepIds } from '../src/renderer/components/PfmeaWizard';
import type { Project } from '../src/shared/types';

const area = (k: string) => FLOW_TEMPLATES.find((t) => t.key === k)!.steps.map((s) => pfmeaAreaOf(`${s.name} ${s.description}`, 'composite'));

function withFlow(keys: string[]): Project {
  const p = newProject();
  p.settings.productType = 'Composite';
  p.processSteps = planFlow(keys, []).map((st, i) => ({ ...blankRow('processSteps', `OP-${String(i + 1).padStart(3, '0')}`), opNo: st.opNo, name: st.name, description: st.description, specialProcess: !!st.specialProcess }) as Project['processSteps'][number]);
  return p;
}

describe('4.9.0 proses seçimi ve kompozit alt prosesleri', () => {
  it('sihirbazdaki her proses bir akış şablonudur', () => {
    for (const k of PROCESS_GROUPS.flatMap((g) => g.keys)) expect(FLOW_TEMPLATES.some((t) => t.key === k)).toBe(true);
  });

  it('kompozit alt proses adımları kendi hata kütüphanesine eşlenir', () => {
    expect(area('handLayup')).toContain('Wet Lay-up');
    expect(area('infusion')).toContain('Infusion');
    expect(area('infusion')).toContain('Cure');
    expect(area('rtm')).toContain('RTM');
    expect(area('winding')).toContain('Filament Winding');
    expect(area('press')).toContain('Compression Molding');
    expect(area('rtm')).not.toContain('Forming');
  });

  it('seçilen proses adımları için kütüphaneden PFMEA satırı üretilir', () => {
    const p = withFlow(['infusion']);
    const ids = wizardStepIds(p, ['infusion'], false);
    expect(ids.length).toBe(p.processSteps.length);
    const g = generate(p, ['pfmea'], { stepIds: ids });
    const modes = g.p.pfmea.map((r) => r.failureMode);
    expect(modes).toContain('Kuru bölge (eksik reçine emdirme)');
    expect(g.p.pfmea.every((r) => r.approval === 'AI Proposed')).toBe(true);
  });

  it('mevcut adımlar dahil edilmezse yalnız seçilen proseslerin adımları alınır', () => {
    const p = withFlow(['machining']);
    p.processSteps.push({ ...blankRow('processSteps', 'OP-099'), name: 'Özel adım' } as Project['processSteps'][number]);
    expect(wizardStepIds(p, ['machining'], false)).not.toContain('OP-099');
    expect(wizardStepIds(p, ['machining'], true)).toContain('OP-099');
  });

  it('AI PFMEA satırı gereksinime bağlanır (bilinmeyen / reddedilmiş çıkarılır)', () => {
    const p = withFlow(['press']);
    p.requirements = [
      { ...blankRow('requirements', 'REQ-001'), text: 'Kalınlık 3±0.2 mm', approval: 'Approved' },
      { ...blankRow('requirements', 'REQ-002'), text: 'x', approval: 'Rejected' },
    ] as Project['requirements'];
    const set = buildProposals(p, 'pfmea', { rows: [{ stepId: p.processSteps[0].id, reqIds: ['REQ-001', 'REQ-002', 'REQ-404'], dfIds: [], failureMode: 'Kalınlık dışı', basis: 'AI INFERENCE', confidence: 'Low', evidence: [] }], issues: [], params: [] }, { role: 'Process Analyst', provider: 'local', model: '', at: '', mode: 'strict', tokensIn: 0, tokensOut: 0, cached: false, retries: 0 }, { inputs: 't' });
    expect(set.items[0].row.reqIds).toEqual(['REQ-001']);
  });
});
