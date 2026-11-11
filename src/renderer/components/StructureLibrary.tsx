// 4.10.0: "📚 Kütüphaneden yapı ekle". Ürün tipi seçilir; tipik yapı ağacı ve eleman fonksiyonları kütüphaneden
// (AI'sız) önerilir, bağlanmamış gereksinimler anahtar kelimeyle ilgili elemana bağlanır. İsteğe bağlı olarak
// eklenen fonksiyonlar için elemana özel DFMEA satırları da önerilir. Hepsi "AI Proposed" ve onay penceresinden geçer.
import { useMemo, useState } from 'react';
import type { Edit } from '../../shared/engine';
import { elementKind } from '../../shared/elementLib';
import { STRUCTURE_TEMPLATES, STRUCTURE_TEMPLATE_BY_KEY, defaultElements, planStructure, suggestStructureTemplate } from '../../shared/structureLib';
import { useStore } from '../store';
import { useAutogen } from './Autogen';
import { Modal } from './Modal';

const GROUPS = ['Kompozit', 'Metal', 'Montaj'] as const;

export function StructureLibrary({ onClose }: { onClose: () => void }) {
  const { project: p, edit, toast, current } = useStore();
  const gen = useAutogen();
  const suggested = useMemo(() => suggestStructureTemplate(p), [p]);
  const [key, setKey] = useState(suggested || STRUCTURE_TEMPLATES[0].key);
  const t = STRUCTURE_TEMPLATE_BY_KEY[key];
  const [sel, setSel] = useState<string[]>(defaultElements(t));
  const [dfmea, setDfmea] = useState(true);
  // Hiçbir elemana uymayan gereksinimler için kural tabanlı ayrı fonksiyon satırı (eski “Gereksinimlerden öner”).
  const [rest, setRest] = useState(true);
  const pick = (k: string) => { setKey(k); setSel(defaultElements(STRUCTURE_TEMPLATE_BY_KEY[k])); };
  const toggle = (k: string) => setSel((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const plan = useMemo(() => planStructure(p, key, sel), [p, key, sel]);

  const run = async () => {
    const before = new Set(p.structure.map((s) => s.id));
    if (plan.edits.length) {
      if (!(await edit(plan.edits as Edit[], `Yapı kütüphanesi: ${t.label}`))) return;
      toast(`${plan.rows} yapı / fonksiyon satırı eklendi, ${plan.linked} gereksinim bağlandı – mühendis onayı bekliyor`);
    }
    onClose();
    if (rest && plan.unmatched.length) await gen(['structure'], 'Elemana uymayan gereksinimlerden fonksiyon satırı', { reqIds: plan.unmatched }, current());
    if (dfmea) {
      const fnIds = current().structure.filter((s) => !before.has(s.id) && s.function?.trim()).map((s) => s.id);
      if (fnIds.length) await gen(['dfmea'], 'Eklenen fonksiyonlar için DFMEA (hata kütüphanesi)', { fnIds }, current());
    }
  };

  return (
    <Modal
      title="Kütüphaneden yapı ekle"
      sub="Ürün tipini seçin; tipik elemanlar ve fonksiyonları AI kullanılmadan önerilir"
      icon="📚"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="muted small">
            {plan.rows} satır eklenecek · {plan.linked} gereksinim bağlanacak{plan.unmatched.length ? ` · ${plan.unmatched.length} gereksinim hiçbir elemana uymadı` : ''}
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!plan.edits.length && !(rest && plan.unmatched.length)} onClick={run}>Yapıyı ekle</button>
        </>
      }
    >
      <h3>1. Ürün tipi</h3>
      {GROUPS.map((g) => (
        <div key={g} className="mt">
          <b>{g}</b>
          <div className="row-btns">
            {STRUCTURE_TEMPLATES.filter((x) => x.group === g).map((x) => (
              <label key={x.key} className="check-row" title={x.hint}>
                <input type="radio" name="structure-template" checked={key === x.key} onChange={() => pick(x.key)} /> {x.label}
                {suggested === x.key && <span className="badge b-blue">önerilen</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">{t.hint}</p>

      <h3 className="mt">2. Elemanlar</h3>
      <table className="effects small">
        <thead>
          <tr><th /><th>Eleman</th><th>Seviye</th><th>Fonksiyonlar</th><th>DFMEA kütüphanesi</th></tr>
        </thead>
        <tbody>
          {t.elements.map((e) => {
            const kind = elementKind(e.name);
            const exists = p.structure.some((s) => s.element.toLocaleLowerCase('tr').trim() === e.name.toLocaleLowerCase('tr'));
            return (
              <tr key={e.key}>
                <td><input type="checkbox" checked={sel.includes(e.key)} onChange={() => toggle(e.key)} /></td>
                <td>
                  <b>{e.name}</b> {e.optional && <span className="badge b-gray">isteğe bağlı</span>} {exists && <span className="badge b-amber" title="Aynı adlı eleman yapı ağacında var; tekrar eklenmez, gereksinimler ona bağlanır">mevcut</span>}
                </td>
                <td className="small">{e.level}</td>
                <td className="small">{e.fns.map((f) => f.text).join(' · ')}</td>
                <td className="small">{kind ? `${kind.label} (${kind.templates.length} hata modu)` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {plan.unmatched.length > 0 && (
        <label className="check-row mt">
          <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} /> Hiçbir elemana uymayan {plan.unmatched.length} gereksinim ({plan.unmatched.join(', ')}) için ayrı fonksiyon satırı öner
        </label>
      )}

      <h3 className="mt">3. DFMEA</h3>
      <label className="check-row">
        <input type="checkbox" checked={dfmea} onChange={(e) => setDfmea(e.target.checked)} /> Eklenen fonksiyonlar için DFMEA satırlarını da kütüphaneden öner (elemana özel hata modları, başlangıç S/O/D)
      </label>
      <p className="muted small">
        Kütüphane sayısal limit içermez; performans gereksinimi bağlanan gereksinimin kabul kriterinden gelir, yoksa boş kalır. Tüm satırlar <b>AI Proposed</b> eklenir:
        ürününüzde olmayan elemanı seçmeyin, adları ve fonksiyonları düzenleyin, onaylayın veya reddedin.
      </p>
    </Modal>
  );
}
