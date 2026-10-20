import { countText, generate, type GenStage } from '../../shared/autogen';
import { fillBlanksEdits } from '../../shared/fmeaFill';
import type { Edit } from '../../shared/engine';
import { useStore } from '../store';

/** DFMEA / PFMEA satırlarının boş alanlarını ilişkili veriden doldurur; dolu alanlara dokunmaz. */
export function useFillBlanks(table: 'dfmea' | 'pfmea') {
  const { project, edit, toast } = useStore();
  return async (ids: string[]) => {
    const edits = fillBlanksEdits(project, table, ids);
    if (!edits.length) return toast('Doldurulacak boş alan yok.', 'warn');
    const rows = new Set(edits.map((e) => e.id)).size;
    if (await edit(edits as Edit[], `${table.toUpperCase()} boş alanları`)) toast(`${rows} satırda ${edits.length} boş alan dolduruldu – AI ÖNERİSİ değerleri onaylayın`);
  };
}

/** Kural tabanlı öneri motorunu çalıştırır; eklemeden önce ne ekleneceğini sorar. Satırlar "AI Proposed" gelir. */
export function useAutogen() {
  const { project, edit, toast, confirm } = useStore();
  return async (stages: GenStage[], title: string, opts: Parameters<typeof generate>[2] = {}) => {
    const g = generate(project, stages, opts);
    if (!g.edits.length) return toast('Önerilecek yeni satır yok (mevcut satırlar korunur, yalnızca eksikler önerilir).', 'warn');
    const ok = await confirm(
      `${title}: ${countText(g)} önerilecek`,
      'Satırlar “AI Proposed” olarak eklenir; S/O/D ve kütüphane metinleri başlangıç önerisidir (güven: Low). Her satırı inceleyip düzenleyin, onaylayın veya silin. Kaynakta olmayan değerler VERİ YOK olarak kalır.',
    );
    if (ok && (await edit(g.edits as Edit[], title))) toast(`${countText(g)} eklendi – mühendis onayı bekliyor`);
  };
}
