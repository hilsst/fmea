// 4.4.0: Malzeme / imalat türüne göre çoklu seçimli proses akışı şablonları.
// Seçilen şablonların adımları Proses Akışı tablosuna eklenir; her adım için PFD girdi/çıktı ve proses
// parametresi adları motor tarafından kütüphaneden önerilir (limitler VERİ YOK). Hepsi onay penceresinden geçer.
import { useState } from 'react';
import type { Edit } from '../../shared/engine';
import { FLOW_SOURCE, FLOW_TEMPLATES, MATERIALS, planFlow, suggestFlowTemplates } from '../../shared/flowLib';
import { blankRow, nextId } from '../../shared/model';
import type { AnyRow, Project } from '../../shared/types';
import { useStore } from '../store';

const split = (s: string | undefined) => (s ?? '').split(';').map((x) => x.trim()).filter(Boolean);

function stepEdits(p: Project, keys: string[]): Edit[] {
  let cur = p;
  return planFlow(keys, p.processSteps).map((st) => {
    const id = nextId(cur, 'processSteps');
    const row = {
      ...blankRow('processSteps', id),
      id,
      opNo: st.opNo,
      name: st.name,
      description: st.description,
      specialProcess: !!st.specialProcess,
      stepType: st.stepType,
      source: `${FLOW_SOURCE} – ${st.template}`,
      origin: 'template',
    } as AnyRow;
    cur = { ...cur, processSteps: [...cur.processSteps, row as never] };
    return { kind: 'add', table: 'processSteps', row } as Edit;
  });
}

export function FlowTemplatePicker({ compact = false }: { compact?: boolean }) {
  const { project: p, mutate, edit } = useStore();
  const suggested = suggestFlowTemplates(p.meta.material ?? '', p.settings.productType);
  const saved = split(p.meta.flowTemplates);
  const [sel, setSel] = useState<string[]>(saved.length ? saved : suggested);
  const preview = planFlow(sel, p.processSteps);
  const toggle = (k: string) => setSel((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const setMaterial = (v: string) => {
    mutate((d) => { d.meta.material = v; });
    if (!saved.length) setSel(suggestFlowTemplates(v, p.settings.productType));
  };
  const apply = async () => {
    const edits = stepEdits(p, sel);
    if (!edits.length) return;
    const ok = await edit(edits, `Proses akışı şablonu: ${FLOW_TEMPLATES.filter((t) => sel.includes(t.key)).map((t) => t.label).join(', ')}`);
    if (ok) mutate((d) => { d.meta.flowTemplates = sel.join(';'); });
  };
  return (
    <div className="flow-picker">
      {!compact && (
        <label className="form-inline">
          <span>Parça malzemesi</span>{' '}
          <select className="cell-select" value={p.meta.material ?? ''} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">—</option>
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      )}
      <div className="row-btns mt">
        {FLOW_TEMPLATES.map((t) => (
          <label key={t.key} className="check-row" title={t.hint}>
            <input type="checkbox" checked={sel.includes(t.key)} onChange={() => toggle(t.key)} /> {t.label}
            {suggested.includes(t.key) && <span className="badge b-blue">önerilen</span>}
          </label>
        ))}
      </div>
      <p className="muted small">
        Seçilen şablonların adımları sırayla (malzeme kabul → imalat → ısıl / yüzey işlem → montaj → son kontrol → sevkiyat) Proses Akışı tablosuna eklenir; aynı adlı mevcut adımlar atlanır, hiçbir adım silinmez.
        Her adım için PFD girdi/çıktı ve proses parametresi adları önerilir; limitler <b>VERİ YOK</b> gelir. Adımlar ENGINEERING SUGGESTION’dır, gerçek akışa göre düzenleyin.
      </p>
      <button className="btn primary" disabled={!preview.length} onClick={apply} title={preview.map((s) => `${s.opNo} ${s.name}`).join('\n')}>
        Proses akışını oluştur{preview.length ? ` (${preview.length} adım)` : ''}
      </button>
      {sel.length > 0 && !preview.length && <span className="muted small"> Seçilen şablonların tüm adımları zaten akışta.</span>}
    </div>
  );
}
