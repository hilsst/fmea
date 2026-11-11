// 4.12.0: Seçili onaylı DFMEA / PFMEA satırlarını firma kütüphanesine ekler (eski "Onaylı örneklerden öner" ve "Benzer FMEA" düğmelerinin yerini alır).
import { recordsFromApproved } from '../../shared/companyLib';
import { useLibWrite } from '../screens/Library';
import { useCompanyLib } from '../companyLibStore';
import { isDesktop } from '../api';
import { useStore } from '../store';

export function AddToLibraryButton({ kind, ids }: { kind: 'dfmea' | 'pfmea'; ids: string[] }) {
  const { project, toast, confirm } = useStore();
  const lib = useCompanyLib();
  const write = useLibWrite();
  if (!isDesktop) return null;
  const run = async () => {
    if (!ids.length) return toast('Önce tabloda onaylı (Approved / Engineer Reviewed) satırları seçin.', 'warn');
    if (!lib.dir) return toast('Önce Kütüphane ekranından firma kütüphanesi klasörünü seçin.', 'warn');
    const r = recordsFromApproved(project, kind, ids, { by: project.settings.userName?.trim() || 'Kullanıcı', lib: lib.merged });
    if (!r.records.length) return toast(`Eklenecek satır yok: ${r.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`, 'warn');
    const skip = r.skipped.length ? ` Atlanan ${r.skipped.length} satır: ${r.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}.` : '';
    if (!(await confirm(`${r.records.length} satır firma kütüphanesine eklensin mi?`, `Proje özel sayısal değerler ve ID’ler ayıklanır; karakteristik / eleman adı {x} olur. Kayıtlar tüm kullanıcılar için ortak klasöre yazılır.${skip}`))) return;
    await write({ upsert: r.records.map((x) => ({ coll: x.coll, rec: x.rec })) }, `${r.records.length} satır firma kütüphanesine eklendi`);
  };
  return (
    <button className="btn" onClick={run} title="Seçili ve onaylı (Approved / Engineer Reviewed) satırları firma kütüphanesine ekler. Proje özel sayılar ve ID’ler ayıklanır.">
      📚 Kütüphaneye ekle{ids.length ? ` (${ids.length})` : ''}
    </button>
  );
}
