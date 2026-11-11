// 4.13.0: Eksik gereksinim kontrol listesi (ürün tipine göre). Eksik konular işaretlenip "AI Proposed" yer tutucu gereksinim olarak eklenebilir.
import { useMemo, useState } from 'react';
import type { Edit } from '../../shared/engine';
import { blankRow, nextId } from '../../shared/model';
import { CHECKLIST_TYPES, checkRequirements, placeholderReq } from '../../shared/reqChecklist';
import type { AnyRow, Project } from '../../shared/types';
import { useStore } from '../store';
import { Modal } from './Modal';

export function ReqChecklistDialog({ onClose }: { onClose: () => void }) {
  const { project, edit, toast } = useStore();
  const guess = CHECKLIST_TYPES.find((t) => t === project.settings.productType) ?? 'General';
  const [type, setType] = useState<string>(guess);
  const res = useMemo(() => checkRequirements(project, type), [project, type]);
  const missing = res.filter((r) => !r.found.length);
  const [pick, setPick] = useState<string[]>([]);
  const toggle = (k: string) => setPick((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const add = async () => {
    let w: Project = project;
    const edits: Edit[] = pick.flatMap((k) => {
      const item = missing.find((m) => m.item.key === k)?.item;
      if (!item) return [];
      const id = nextId(w, 'requirements');
      const row = { ...blankRow('requirements', id), ...placeholderReq(item, type), id } as AnyRow;
      w = { ...w, requirements: [...w.requirements, row as never] };
      return [{ kind: 'add' as const, table: 'requirements' as const, row }];
    });
    if (!edits.length) return;
    if (await edit(edits, 'Eksik gereksinim kontrol listesi')) {
      toast(`${edits.length} yer tutucu gereksinim eklendi (AI Proposed) – şartnameyle doldurun veya silin`);
      onClose();
    }
  };
  return (
    <Modal
      title="Eksik gereksinim kontrolü"
      sub="Ürün tipine göre tipik konular; yalnız hatırlatır, sayısal değer içermez"
      icon="☑"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Kapat</button>
          <button className="btn primary" disabled={!pick.length} onClick={add}>Seçilenleri gereksinim olarak ekle ({pick.length})</button>
        </>
      }
    >
      <label className="row-btns">
        Ürün tipi:&nbsp;
        <select value={type} onChange={(e) => { setType(e.target.value); setPick([]); }}>
          {CHECKLIST_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="muted small">&nbsp;{res.length - missing.length}/{res.length} konu mevcut gereksinimlerde geçiyor</span>
      </label>
      <p className="muted small">Eşleşme metin taramasıdır: “Eksik” demek şartnamenin konuyu kapsamadığı anlamına gelmez, yalnız gereksinim listesinde geçmediğini gösterir. Eklenen satır boş bir yer tutucudur (AI Proposed); değeri şartnameden siz girersiniz.</p>
      <table className="effects">
        <tbody>
          {res.map(({ item, found }) => (
            <tr key={item.key}>
              <td className="nowrap">{found.length ? '✓' : <input type="checkbox" checked={pick.includes(item.key)} onChange={() => toggle(item.key)} />}</td>
              <td><b>{item.label}</b><div className="muted small">{item.why}</div></td>
              <td className="muted small">{found.length ? `Mevcut: ${found.slice(0, 4).join(', ')}${found.length > 4 ? '…' : ''}` : 'Gereksinim listesinde görünmüyor'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
