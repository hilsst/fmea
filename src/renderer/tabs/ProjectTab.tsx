import { completenessScore, qualityChecks } from '../../shared/checks';
import { needsAction } from '../../shared/risk'; // v4-risk
import { isScmh } from '../../shared/scmhScoring'; // v4-risk
import { SCMH_DFMEA_LEVELS, SCMH_PHASES, type ProjectMeta, type Settings } from '../../shared/types';
import { TextCell } from '../components/Cells';
import { useStore } from '../store';
import type { TabKey } from '../../shared/tabs';

const META_FIELDS: [keyof ProjectMeta, string, boolean?][] = [
  ['name', 'Proje adı'],
  ['partNumber', 'Parça numarası'],
  ['partName', 'Parça adı'],
  ['customer', 'Müşteri'],
  ['program', 'Program'],
  ['drawingRevision', 'Resim revizyonu'],
  ['fmeaNumber', 'FMEA numarası'],
  ['fmeaRevision', 'FMEA revizyonu'],
  ['preparedBy', 'Hazırlayan'],
  ['team', 'FMEA ekibi (isim / rol)', true],
  ['startDate', 'Başlangıç tarihi'],
  ['revisionDate', 'Revizyon tarihi'],
  ['supplier', 'Tedarikçi / Tesis'],
  ['location', 'Lokasyon'],
  ['confidentiality', 'Gizlilik seviyesi'],
  ['scope', 'Kapsam / Sınırlar (dahil olan – olmayan)', true],
  // SCMH form başlıkları
  ['organization', 'Şirket / Organizasyon adı (SCMH)'],
  ['exportControl', 'Export Control Classification'],
  ['otherRestrictions', 'Diğer kısıtlamalar'],
  ['productOwner', 'Ürün sahibi ve e-posta (DFMEA)'],
  ['processOwner', 'Proses sahibi ve e-posta (PFMEA/PFD/CP)'],
  ['facilitator', 'FMEA facilitator ve e-posta'],
];

export function ProjectTab({ go }: { go: (t: TabKey) => void }) {
  const { project, mutate, edit } = useStore();
  const p = project;
  const setMeta = (k: keyof ProjectMeta) => (v: unknown) => {
    mutate((d) => {
      d.meta[k] = String(v ?? '');
    });
    return Promise.resolve(true);
  };
  const setSetting = (k: keyof Settings) => (v: unknown) => edit({ kind: 'settings', field: k, value: v }, 'Ayar değişikliği');

  const fm = [...p.dfmea, ...p.pfmea];
  const apH = fm.filter((r) => needsAction(p, r).need).length; // v4-risk: tek yüklem
  const highS = fm.filter((r) => (r.s ?? 0) >= p.settings.highSeverityThreshold).length;
  const openAct = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length;
  const overdue = p.actions.filter((a) => a.dueDate && a.status !== 'Completed' && a.status !== 'Cancelled' && a.dueDate < new Date().toISOString().slice(0, 10)).length;
  const kcPending = p.kcs.filter((k) => k.status === 'AI Proposed' || !k.status).length;
  const reassess = [...p.requirements, ...p.dfmea, ...p.pfmea, ...p.processSteps, ...p.structure].filter((r) => r.reassess).length;
  const score = completenessScore(qualityChecks(p));

  const tiles: { label: string; value: number | string; tab: TabKey; tone?: string }[] = [
    { label: 'Gereksinim', value: p.requirements.length, tab: 'requirements' },
    { label: 'DFMEA satırı', value: p.dfmea.length, tab: 'dfmea' },
    { label: 'PFMEA satırı', value: p.pfmea.length, tab: 'pfmea' },
    { label: isScmh(p) ? 'SCMH inceleme (S≥9 / Top-N / KC)' : 'AP = High', value: apH, tab: 'dfmea', tone: apH ? 'red' : '' },
    { label: 'Yüksek Severity', value: highS, tab: 'dfmea', tone: highS ? 'red' : '' },
    { label: 'Onay bekleyen KC', value: kcPending, tab: 'kcs', tone: kcPending ? 'amber' : '' },
    { label: 'Açık aksiyon', value: openAct, tab: 'actions', tone: openAct ? 'blue' : '' },
    { label: 'Geciken aksiyon', value: overdue, tab: 'actions', tone: overdue ? 'red' : '' },
    { label: 'Yeniden değerlendirme', value: reassess, tab: 'quality', tone: reassess ? 'amber' : '' },
    { label: 'Tamlık skoru', value: `%${score}`, tab: 'quality', tone: score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red' },
  ];

  return (
    <div className="page">
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.label} className={`tile ${t.tone ?? ''}`} onClick={() => go(t.tab)}>
            <div className="tile-v">{t.value}</div>
            <div className="tile-l">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="two-col">
        <section className="card">
          <h3>Proje bilgileri</h3>
          <div className="form">
            {META_FIELDS.map(([k, label, multi]) => (
              <label key={k} className={multi ? 'wide' : ''}>
                <span>{label}</span>
                <TextCell value={p.meta[k]} onCommit={setMeta(k)} multiline={multi} type={k.endsWith('Date') ? 'date' : 'text'} />
              </label>
            ))}
            <label>
              <span>DFMEA seviyesi (SCMH)</span>
              <select className="cell-select" value={p.meta.dfmeaLevel} onChange={(e) => setMeta('dfmeaLevel')(e.target.value)}>
                <option value="">—</option>
                {SCMH_DFMEA_LEVELS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label>
              <span>PFMEA / Kontrol Planı aşaması (SCMH)</span>
              <select className="cell-select" value={p.meta.scmhPhase} onChange={(e) => setMeta('scmhPhase')(e.target.value)}>
                <option value="">—</option>
                {SCMH_PHASES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Risk ve KC kuralları</h3>
          <p className="muted">Bu değerler değiştiğinde bütün DFMEA/PFMEA satırları yeniden değerlendirilir ve etkilenen KC adayları onayınıza sunulur.</p>
          <div className="form">
            <label>
              <span>KC Severity eşiği (bu değer ve üstü otomatik KC adayı)</span>
              <select className="cell-select" value={p.settings.kcSeverityThreshold} onChange={(e) => setSetting('kcSeverityThreshold')(Number(e.target.value))}>
                {[10, 9, 8, 7, 6, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              <span>High Severity vurgusu</span>
              <select className="cell-select" value={p.settings.highSeverityThreshold} onChange={(e) => setSetting('highSeverityThreshold')(Number(e.target.value))}>
                {[10, 9, 8, 7, 6, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              <span>RPN aksiyon eşiği (varsayılan 100; boş = kullanılmaz)</span>
              <TextCell value={p.settings.rpnThreshold ?? ''} type="number" onCommit={(v) => setSetting('rpnThreshold')(v)} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={p.settings.rpnAutoAction !== false} onChange={(e) => setSetting('rpnAutoAction')(e.target.checked)} />
              <span>RPN eşiği aşılınca boş “Önerilen Aksiyon” alanını satırın neden / kontrol bilgisinden doldur (AI RECOMMENDATION; sorumlu VERİ YOK, termin ve tahmini puan boş kalır)</span>
            </label>
            <label>
              <span>Hedef Cpk / Ppk (boş = VERİ YOK)</span>
              <TextCell value={p.settings.targetCpk ?? ''} type="number" onCommit={(v) => setSetting('targetCpk')(v)} />
            </label>
            <label>
              <span>Capability minimum örnek sayısı</span>
              <TextCell value={p.settings.minSamples ?? ''} type="number" onCommit={(v) => setSetting('minSamples')(v)} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={p.settings.autoKcCandidates} onChange={(e) => setSetting('autoKcCandidates')(e.target.checked)} />
              <span>Yüksek severity satırlar için otomatik “AI Recommended KC” adayı oluştur</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={p.settings.autoControlPlan} onChange={(e) => setSetting('autoControlPlan')(e.target.checked)} />
              <span>KC onaylandığında kontrol planı, MSA ve capability satırlarını öner</span>
            </label>
          </div>
          <div className="callout">
            <b>Önceliklendirme (spesifikasyon §18):</b> 1) Emniyet / regülasyon 2) Yüksek severity 3) KC 4) Özel karakteristik 5) AP High 6) Yüksek RPN 7) Müşteriye özel. RPN tek başına karar kriteri değildir (S=10, O=2, D=2 düşük risk sayılmaz).
          </div>
          <div className="callout">
            <b>Etiketler:</b> Eksik bilgi “VERİ YOK – doğrulanmalı”, varsayım “AI VARSAYIMI – mühendislik doğrulaması gerekli”, öneri “AI RECOMMENDATION”. KC, Severity, AP, gereksinim ve kabul kriteri mühendis onayı olmadan kesinleşmez.
          </div>
        </section>
      </div>
    </div>
  );
}
