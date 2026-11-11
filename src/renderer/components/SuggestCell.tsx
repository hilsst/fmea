// 4.13.0: Hücre içi kütüphane önerisi. Hücrenin köşesindeki 📚 düğmesi, satırın bağlamına uyan kütüphane metinlerini listeler;
// seçilen metin hücreye yazılır (satır onayı değişmez kuralları motorda; seçim bir öneridir, doğrulama mühendistedir).
import { useEffect, useState, type ReactNode } from 'react';
import { cellSuggestions, type CellSuggestion, type SuggestTable } from '../../shared/cellSuggest';
import type { AnyRow, DfmeaRow, PfmeaRow } from '../../shared/types';
import { useCompanyLib } from '../companyLibStore';
import { useStore } from '../store';

export function SuggestCell({ table, row, field, onPick, children }: { table: SuggestTable; row: AnyRow; field: string; onPick: (text: string) => void; children: ReactNode }) {
  const { project } = useStore();
  const lib = useCompanyLib();
  const [list, setList] = useState<CellSuggestion[] | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!list) return;
    const close = () => setList(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [list]);
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(r.right - 360, window.innerWidth - 376)), y: Math.min(r.bottom + 4, window.innerHeight - 280) });
    setList(cellSuggestions(project, table, row as DfmeaRow | PfmeaRow, field, lib.status === 'loading' ? undefined : lib.merged));
  };
  return (
    <div className="sugg-wrap">
      {children}
      <button className="sugg-btn" title="Kütüphaneden öneri (yalnız metin; değeri doğrulayın)" onMouseDown={(e) => e.stopPropagation()} onClick={open}>📚</button>
      {list && pos && (
        <div className="sugg-pop" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
          {list.length === 0 ? (
            <div className="muted small pad">{field !== 'failureMode' && !(row as DfmeaRow).failureMode?.trim() ? 'Önce hata modunu girin; öneriler o moda göre gelir.' : 'Bu bağlam için kütüphanede yeni öneri yok. “AI ile kontrol et / oluştur” seçenekleri kullanılabilir.'}</div>
          ) : (
            list.map((s) => (
              <button
                key={s.text}
                className="sugg-item"
                onClick={() => {
                  setList(null);
                  onPick(s.text);
                }}
              >
                <span>{s.text}</span>
                <small className="muted">{s.company ? 'Firma · ' : ''}{s.scope}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
