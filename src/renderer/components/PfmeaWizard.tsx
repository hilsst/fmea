// 4.9.0: "Proses seç ve PFMEA oluştur" sihirbazı.
// 1) Hangi proses(ler) için PFMEA yapılacağı sorulur (talaşlı, sac eğme-bükme, kompozit alt prosesleri …).
// 2) Seçilen proseslerin adımları Proses Akışı'na eklenir (mevcut adımlar silinmez), PFD girdi/çıktı ve parametre adları motorca önerilir.
// 3) Hata kütüphanesinden her adım için tüm hata modları ve 4M nedenleri önerilir.
// 4) İsteğe bağlı: AI, gereksinimler ve DFMEA satırlarından bu adımlarda oluşabilecek proses hata modlarını önerir.
// Her aşama kendi onay penceresinden geçer; satırlar "AI Proposed" gelir, onay mühendisindir.
import { useState } from 'react';
import { FLOW_HEAD, FLOW_TAIL, FLOW_TEMPLATES, planFlow, suggestFlowTemplates } from '../../shared/flowLib';
import { dfmeaTransferReason, requirementTransferReason } from '../../shared/pfmeaImport';
import { stepEdits } from './FlowTemplates';
import { Modal } from './Modal';
import { useAutogen } from './Autogen';
import { useStore } from '../store';
import type { Project } from '../../shared/types';

/** Proses grupları (sihirbazda başlık altında gösterilir). */
export const PROCESS_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Kompozit imalat', keys: ['composite', 'handLayup', 'infusion', 'rtm', 'winding', 'press'] },
  { label: 'Metal imalat', keys: ['machining', 'sheet', 'welding', 'heat', 'surface'] },
  { label: 'Montaj', keys: ['assembly', 'riveting'] },
];

const key = (s: string) => s.toLocaleLowerCase('tr').trim();

/** Seçilen proseslerin (ve ortak baş/son adımların) projedeki adım ID'leri. */
export function wizardStepIds(p: Project, keys: string[], includeExisting: boolean): string[] {
  if (includeExisting) return p.processSteps.map((s) => s.id);
  const names = new Set([...FLOW_HEAD, ...FLOW_TAIL, ...FLOW_TEMPLATES.filter((t) => keys.includes(t.key)).flatMap((t) => t.steps)].map((s) => key(s.name)));
  return p.processSteps.filter((s) => names.has(key(s.name))).map((s) => s.id);
}

export function PfmeaWizard({ onClose, suggestPfmea }: { onClose: () => void; suggestPfmea: (stepIds: string[], base?: Project) => Promise<void> }) {
  const { project: p, edit, mutate, current, toast } = useStore();
  const gen = useAutogen();
  const saved = (p.meta.flowTemplates ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  const [sel, setSel] = useState<string[]>(saved.length ? saved : suggestFlowTemplates(p.meta.material ?? '', p.settings.productType));
  const [existing, setExisting] = useState(p.processSteps.length > 0 && !saved.length);
  const [lib, setLib] = useState(true);
  const [ai, setAi] = useState(true);
  const preview = planFlow(sel, p.processSteps);
  const dfCount = p.dfmea.filter((d) => dfmeaTransferReason(p, d)).length;
  const reqCount = p.requirements.filter((r) => r.approval !== 'Rejected' && requirementTransferReason(p, r)).length;
  const toggle = (k: string) => setSel((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const nothing = !sel.length && !(existing && p.processSteps.length);

  const run = async () => {
    onClose();
    const edits = stepEdits(p, sel);
    if (edits.length) {
      const title = `Proses akışı: ${FLOW_TEMPLATES.filter((t) => sel.includes(t.key)).map((t) => t.label).join(', ')}`;
      if (!(await edit(edits, title))) return;
      mutate((d) => {
        d.meta.flowTemplates = [...new Set([...saved, ...sel])].join(';');
      });
    }
    const stepIds = wizardStepIds(current(), sel, existing);
    if (!stepIds.length) return toast('PFMEA yapılacak proses adımı yok.', 'warn');
    if (lib) await gen(['pfmea'], 'Seçilen prosesler için PFMEA (hata kütüphanesi)', { stepIds }, current());
    if (ai) await suggestPfmea(stepIds, current());
  };

  return (
    <Modal
      title="Proses seç ve PFMEA oluştur"
      sub="PFMEA hangi imalat prosesleri için hazırlanacak?"
      icon="✦"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="muted small">{preview.length ? `${preview.length} yeni proses adımı eklenecek` : sel.length ? 'Seçilen proseslerin adımları zaten akışta' : ''}</span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={nothing || (!lib && !ai && !preview.length)} onClick={run}>
            PFMEA’yı oluştur
          </button>
        </>
      }
    >
      <h3>1. Prosesler</h3>
      {PROCESS_GROUPS.map((g) => (
        <div key={g.label} className="mt">
          <b>{g.label}</b>
          <div className="row-btns">
            {g.keys.map((k) => {
              const t = FLOW_TEMPLATES.find((x) => x.key === k);
              return t ? (
                <label key={k} className="check-row" title={t.hint}>
                  <input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} /> {t.label}
                </label>
              ) : null;
            })}
          </div>
        </div>
      ))}
      {p.processSteps.length > 0 && (
        <label className="check-row mt">
          <input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} /> Proses Akışı’ndaki mevcut {p.processSteps.length} adımı da PFMEA’ya dahil et
        </label>
      )}
      <p className="muted small">
        Seçilen proseslerin adımları sırayla (malzeme kabul → imalat → ısıl / yüzey işlem → montaj → son kontrol → sevkiyat) Proses Akışı’na eklenir; aynı adlı mevcut adımlar atlanır, hiçbir adım silinmez. Adımlar ENGINEERING SUGGESTION’dır, gerçek akışınıza göre düzenleyin.
      </p>

      <h3 className="mt">2. PFMEA kaynakları</h3>
      <label className="check-row">
        <input type="checkbox" checked={lib} onChange={(e) => setLib(e.target.checked)} /> Hata kütüphanesi: her adım için prosese özgü tüm hata modları, 4M nedenleri, önleme / tespit ve başlangıç S/O/D (AI’sız)
      </label>
      <label className="check-row">
        <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> AI: gereksinimlerden ve DFMEA’dan bu adımlarda oluşabilecek proses hata modları (DFMEA ve gereksinim bağlantılarıyla)
      </label>
      <p className="muted small">
        Projede PFMEA’ya taşınması önerilen {dfCount} DFMEA satırı (S yüksek, KC adayı, üretilebilirlik) ve {reqCount} proses / muayene / boyutsal gereksinim var. AI bunları uygun adıma bağlar; her öneriyi kabul / düzenle / reddet ile siz onaylarsınız.
        AI için internet ve API anahtarı gerekir; adımlar 4’erli gruplar halinde gönderilir.
      </p>
    </Modal>
  );
}
