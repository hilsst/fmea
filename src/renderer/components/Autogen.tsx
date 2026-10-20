import { countText, generate, type GenStage } from '../../shared/autogen';
import type { Edit } from '../../shared/engine';
import { useStore } from '../store';

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
