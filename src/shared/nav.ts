// 2.0 sol menü (§46). Ekranlar çalışma sırasına göre gruplanır; bazı ekranların alt sekmeleri vardır.
import type { TableKey } from './types';

export type ScreenKey =
  | 'dashboard' | 'project' | 'documents' | 'requirements' | 'dfmea' | 'pfmea' | 'risk' | 'kcs' | 'controlPlan' | 'msa'
  | 'capability' | 'actions' | 'lessons' | 'traceability' | 'impact' | 'quality' | 'aiReview' | 'approval' | 'baseline' | 'settings';

export interface SubTab {
  key: string;
  label: string;
  table?: TableKey;
}

export interface Screen {
  key: ScreenKey;
  label: string;
  group: string;
  stage: string;
  hint: string;
  subs?: SubTab[];
}

export const SCREENS: Screen[] = [
  { key: 'dashboard', label: 'Gösterge Paneli', group: 'Genel', stage: 'Genel bakış', hint: 'Projenin durumu, kalite skoru, bekleyen kararlar ve sıradaki onay adımı.' },
  { key: 'project', label: 'Proje', group: 'Genel', stage: 'Adım 1 · Planlama', hint: 'Kapsam, ekip, parça, ürün tipi ve revizyon bilgileri.' },
  {
    key: 'documents', label: 'Dokümanlar', group: 'Girdi', stage: 'Document Intelligence', hint: 'Dokümanları ekleyin ve yerel olarak analiz edin. Kanıtlar ve açık konular burada tutulur.',
    subs: [{ key: 'documents', label: 'Dokümanlar', table: 'documents' }, { key: 'evidence', label: 'Kanıtlar', table: 'evidence' }, { key: 'issues', label: 'Açık Konular', table: 'issues' }],
  },
  { key: 'requirements', label: 'Gereksinimler', group: 'Girdi', stage: 'Requirement Engine', hint: 'Her gereksinim kaynağı, konumu, nominal/limitleri ve kanıtıyla tutulur.' },
  {
    key: 'dfmea', label: 'DFMEA', group: 'Analiz', stage: 'Adım 2–6 · Tasarım FMEA', hint: 'Sistem → Alt sistem → Komponent → Fonksiyon → Gereksinim → Hata modu → Etki → Neden → Kontroller → Risk → Aksiyon.',
    subs: [{ key: 'structure', label: 'Yapı & Fonksiyon', table: 'structure' }, { key: 'dfmea', label: 'DFMEA', table: 'dfmea' }],
  },
  {
    key: 'pfmea', label: 'PFMEA', group: 'Analiz', stage: 'Adım 2–6 · Proses FMEA', hint: 'Proses adımı → Proses elemanı (4M/5M) → Fonksiyon → Gereksinim → Hata modu → Neden (5 Neden) → Kontroller.',
    subs: [{ key: 'processSteps', label: 'Proses Akışı (PFD)', table: 'processSteps' }, { key: 'pfdItems', label: 'PFD Girdi / Çıktı', table: 'pfdItems' } /* v4-risk */, { key: 'processParams', label: 'Proses Parametreleri', table: 'processParams' }, { key: 'pfmea', label: 'PFMEA', table: 'pfmea' }],
  },
  { key: 'risk', label: 'Risk', group: 'Analiz', stage: 'Risk Engine', hint: 'Puanlama standardı (IAQG SCMH veya AIAG-VDA), S/O/D kriterleri ve önceliklendirme.' },
  {
    key: 'kcs', label: 'Özel Karakteristikler', group: 'Analiz', stage: 'Special Characteristic Engine', hint: 'KC adayları faktörleriyle değerlendirilir; karar ve kategori mühendisindir.',
    // v4-kc: SCMH / AS9145 KC–CI bölümleri
    subs: [{ key: 'kcs', label: 'KC / CI Listesi', table: 'kcs' }, { key: 'kcFlow', label: 'Adaylar & Karar Akışı' }, { key: 'kcTrace', label: 'İzlenebilirlik & 7.2.16' }],
  },
  { key: 'controlPlan', label: 'Kontrol Planı', group: 'Kontrol', stage: 'Control Plan Engine', hint: 'Ürün karakteristiği, proses karakteristiği ve proses parametresi ayrı tutulur.' },
  { key: 'msa', label: 'MSA', group: 'Kontrol', stage: 'Ölçüm Sistemi Analizi', hint: 'Ölçüm tipine göre çalışma önerilir; her ölçüm için GR&R zorunlu değildir.' },
  { key: 'capability', label: 'Capability', group: 'Kontrol', stage: 'Capability Validation', hint: 'Cp/Cpk/Pp/Ppk yalnızca normallik, kararlılık ve yeterli örnekle geçerlidir.' },
  { key: 'actions', label: 'Aksiyonlar', group: 'Kontrol', stage: 'Adım 6 · Optimizasyon', hint: 'FMEA’da önerilen aksiyonlar iki yönlü senkronize izlenir.' },
  {
    key: 'lessons', label: 'Dersler', group: 'Bilgi', stage: 'Lessons Learned', hint: 'NCR, 8D, CAPA, şikayet, hurda, yeniden işleme, denetim, garanti ve test hataları.',
    subs: [{ key: 'lessons', label: 'Dersler', table: 'lessons' }, { key: 'kb', label: 'Bilgi Tabanı' }],
  },
  { key: 'traceability', label: 'İzlenebilirlik', group: 'Doğrulama', stage: 'Traceability', hint: 'Matrisler ve bağlantı grafiği: gereksinimden kontrol planına.' },
  {
    key: 'impact', label: 'Değişiklik Etkisi', group: 'Doğrulama', stage: 'Change Impact', hint: 'Bir kaydın değişmesi hangi mühendislik kayıtlarını etkiler?',
    subs: [{ key: 'impact', label: 'Etki Analizi' }, { key: 'changeRequests', label: 'Değişiklik Talepleri', table: 'changeRequests' }],
  },
  { key: 'quality', label: 'Kalite Kontrol', group: 'Doğrulama', stage: 'Quality Engine', hint: 'Level 1 yapısal + Level 2 mühendislik kontrolleri, FMEA Quality Score ve “Neyi kaçırdım?”.' },
  {
    key: 'aiReview', label: 'AI İnceleme', group: 'Doğrulama', stage: 'AI Review Engine', hint: 'Bağımsız AI denetçi önerileri. AI hiçbir kaydı onaylamaz.',
    subs: [{ key: 'review', label: 'AI İnceleme' }, { key: 'aiRuns', label: 'AI Çalıştırmaları', table: 'aiRuns' }],
  },
  {
    key: 'approval', label: 'Onay', group: 'Onay', stage: 'Engineering Approval', hint: 'AI Draft → Mühendis → Tasarım → Üretim → Kalite → Final onay → Baseline.',
    subs: [{ key: 'workflow', label: 'Onay Akışı' }, { key: 'audit', label: 'Denetim İzi' }],
  },
  {
    key: 'baseline', label: 'Revizyon / Baseline', group: 'Onay', stage: 'Revision Control', hint: 'Revizyonlar ve değiştirilemez baseline kayıtları.',
    subs: [{ key: 'history', label: 'Revizyon Geçmişi', table: 'history' }, { key: 'baselines', label: 'Baselines' }],
  },
  { key: 'settings', label: 'Ayarlar', group: 'Sistem', stage: 'Ayarlar', hint: 'Kullanıcı, AI, şirket şablonu, KC kuralları, onay akışı ve opsiyonel IFS bağlantısı.' },
];

export const SCREEN_BY_KEY = Object.fromEntries(SCREENS.map((s) => [s.key, s])) as Record<ScreenKey, Screen>;

/** Bir tablo hangi ekranda/alt sekmede? (onay penceresi ve "Git" bağlantıları için) */
export function screenOfTable(t: string): { screen: ScreenKey; sub?: string } | null {
  for (const s of SCREENS) {
    if (s.key === t && !s.subs) return { screen: s.key };
    const sub = s.subs?.find((x) => x.table === t);
    if (sub) return { screen: s.key, sub: sub.key };
  }
  return null;
}

export function screenLabel(t: string): string {
  const loc = screenOfTable(t);
  if (!loc) return t === 'settings' ? 'Ayarlar' : t;
  const s = SCREEN_BY_KEY[loc.screen];
  const sub = s.subs?.find((x) => x.key === loc.sub);
  return sub && sub.label !== s.label ? `${s.label} › ${sub.label}` : s.label;
}
