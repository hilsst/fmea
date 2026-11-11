// v4-risk: SCMH risk ekranı parçaları: RPN / S×O / S×D sıralaması, inceleme listesi (Top-N), SCMH çıktı seçenekleri,
// sabit satır numaraları ve DFMEA kapsam paneli (9145 risk kategorileri, gürültü faktörleri).
import { useMemo, useState } from 'react';
import { AS9145_CATEGORIES, actionAddressed, needLabel, needsAction, RISK_LISTS } from '../../shared/risk';
import { LINE_TABLES, renumberLines, type LineTable } from '../../shared/riskModel';
import { SCMH_MEASURES, scmhPriority, scmhSortBy, type ScmhMeasure } from '../../shared/scmhScoring';
import { TABLE_LABEL } from '../../shared/model';
import { useStore } from '../store';

export function ScmhPriorityPanel() {
  const { project: p, edit, mutate, confirm } = useStore();
  const [m, setM] = useState<ScmhMeasure>('rpn');
  const ranked = useMemo(() => scmhSortBy([...p.dfmea, ...p.pfmea].filter((r) => r.failureMode), m).slice(0, 40), [p, m]);
  const topN = p.settings.scmhReviewTopN;
  const setTopN = (v: string) => {
    const n = v.trim() === '' ? null : Math.max(1, Math.round(Number(v)));
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== topN) void edit({ kind: 'settings', field: 'scmhReviewTopN', value: n }, 'SCMH inceleme listesi (Top-N)');
  };
  const renumber = async (t: LineTable) => {
    if (!(await confirm(`${TABLE_LABEL[t]} satır numaraları yeniden verilsin mi?`, `${TABLE_LABEL[t]} satır numaraları SCMH çıktı sırasına göre 1…n olarak yeniden verilecek.\n\nRevizyon geçmişi ve KC formu notları eski numaralara atıf yapıyorsa güncellenmelidir. Baseline öncesi yapılması önerilir.\n\n`))) return;
    mutate((d) => renumberLines(d, t), { kind: 'Modified', table: t, id: 'lineNo', field: 'lineNo', comment: `${TABLE_LABEL[t]} satır numaraları yeniden verildi` });
  };
  return (
    <>
      <section className="card">
        <h3>SCMH öncelik sırası (ilk {ranked.length})</h3>
        <p className="muted small">SCMH 7.2.3 p59: S×O (SO), S×D (SD) ve RPN ile önceliklendirme; S 9–10 her zaman önce ve RPN’den bağımsız incelenir. Eşik yoktur (DFMEA Guidance O19).</p>
        <div className="row-btns">
          <label>Sıralama{' '}
            <select className="cell-select" value={m} onChange={(e) => setM(e.target.value as ScmhMeasure)}>
              {SCMH_MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <label title="Ekibin kararlaştırdığı inceleme listesi: her ölçütte (RPN, S×O, S×D) ilk N satır aksiyon/karar gerektirir. Boş = yalnızca S≥9 ve KC/CI.">
            İnceleme listesi (her ölçütte ilk N){' '}
            <input className="cell-input" style={{ width: 70 }} defaultValue={topN ?? ''} placeholder="—" onBlur={(e) => setTopN(e.target.value)} />
          </label>
        </div>
        {ranked.length === 0 && <p className="muted">Puanlanmış hata modu yok.</p>}
        <table className="effects">
          <thead><tr><th>#</th><th>ID</th><th>Hata modu</th><th>S</th><th>O</th><th>D</th><th>RPN</th><th>S×O</th><th>S×D</th><th>Aksiyon gerekli</th><th>Durum</th></tr></thead>
          <tbody>
            {ranked.map((r, i) => {
              const pr = scmhPriority(r);
              const need = needsAction(p, r).need;
              return (
                <tr key={r.id} className="click" onClick={() => window.dispatchEvent(new CustomEvent('why', { detail: r.id }))}>
                  <td>{i + 1}</td>
                  <td className="rid">{r.id}{pr.review && <span className="badge b-red"> S≥9</span>}</td>
                  <td>{r.failureMode}</td>
                  <td>{r.s ?? '–'}</td><td>{r.o ?? '–'}</td><td>{r.d ?? '–'}</td>
                  <td>{pr.rpn ?? '–'}</td><td>{pr.so ?? '–'}</td><td>{pr.sd ?? '–'}</td>
                  <td className="small">{needLabel(p, r)}</td>
                  <td className="small">{need ? (actionAddressed(r) ? (r.riskDecision?.startsWith('No action') ? r.riskDecision : 'Aksiyon var') : <span className="badge b-red">Aksiyon/karar yok</span>) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>SCMH çıktı seçenekleri</h3>
        <label className="check-row"><input type="checkbox" checked={!!p.settings.scmhInlineRanks} onChange={(e) => void edit({ kind: 'settings', field: 'scmhInlineRanks', value: e.target.checked }, 'SCMH çıktısı')} /> Kontrol ve etki metnine puanı “(n)” olarak ekle (SCMH 7.2.19 örneklerindeki gibi)</label>
        <label className="check-row"><input type="checkbox" checked={!!p.settings.scmhCommentsColumn} onChange={(e) => void edit({ kind: 'settings', field: 'scmhCommentsColumn', value: e.target.checked }, 'SCMH çıktısı')} /> Form dışı “Comments” sütunu: puan gerekçeleri, ALARP/aksiyon kararı, öngörülen/gerçekleşen sonuç, notlar</label>
        <h3 className="mt">Satır numaraları (Doc (Line) #)</h3>
        <p className="muted small">Numara satıra bir kez verilir; silinen satırın numarası yeniden kullanılmaz (SCMH 7.2.19 Fire Ex). Yeniden numaralandırma mühendis kararıdır ve denetim izine yazılır.</p>
        <div className="row-btns">
          {LINE_TABLES.map((t) => <button key={t} className="btn" onClick={() => renumber(t)}>{TABLE_LABEL[t]}: yeniden numaralandır</button>)}
        </div>
      </section>
    </>
  );
}

/** DFMEA kapsam paneli: 9145 risk kategorileri ve gürültü faktörleri başına satır sayısı (DRA webinar slide 14, 23, 39). */
export function DfmeaCoveragePanel() {
  const { project: p } = useStore();
  const df = p.dfmea.filter((d) => d.failureMode);
  if (!df.length) return null;
  const count = (k: 'riskCategory' | 'noiseFactor', v: string) => df.filter((d) => (d[k] ?? []).includes(v)).length;
  const chip = (label: string, n: number) => <span key={label} className={`badge ${n ? 'b-green' : 'b-amber'}`} style={{ marginRight: 6 }}>{label}: {n}</span>;
  const cats = [...AS9145_CATEGORIES, 'Testability'];
  const missing = cats.filter((c) => !count('riskCategory', c)).length + RISK_LISTS.noiseFactor.filter((c) => !count('noiseFactor', c)).length;
  // 4.4.1: varsayılan kapalı tek satır; DFMEA tablosu pencereyi doldurur
  return (
    <details className="card coverage">
      <summary><b>DFMEA kapsamı</b> <span className={`badge ${missing ? 'b-amber' : 'b-green'}`}>{missing ? `${missing} etiketsiz kategori / gürültü faktörü` : 'Tümü etiketli'}</span></summary>
      <p className="small"><b>9145 risk kategorileri:</b> {AS9145_CATEGORIES.map((c) => chip(c, count('riskCategory', c)))} {chip('Testability', count('riskCategory', 'Testability'))}</p>
      <p className="small"><b>Gürültü faktörleri:</b> {RISK_LISTS.noiseFactor.map((c) => chip(c, count('noiseFactor', c)))}</p>
      <p className="muted small">Sarı = hiçbir satırda etiketlenmemiş. Çevre: sıcaklık, titreşim, gürültü, radyasyon duyarlılığı. Eksikler “Neyi kaçırdım?” listesinde de görünür.</p>
    </details>
  );
}
