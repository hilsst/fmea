import type { TableKey } from './types';

export type TabKey = TableKey | 'project' | 'traceability' | 'quality' | 'scoring';

export interface TabDef {
  key: TabKey;
  label: string;
  /** AIAG-VDA 7 adım karşılığı / çalışma sırasındaki yeri. */
  stage: string;
  hint: string;
}

/** Sekmeler FMEA çalışma sırasına göre dizilir (AIAG-VDA 7 adım + spesifikasyon §38 çalışma akışı). */
export const TABS: TabDef[] = [
  { key: 'project', label: 'Proje', stage: 'Adım 1 · Planlama', hint: 'Kapsam, ekip, parça ve revizyon bilgileri; KC ve risk eşikleri.' },
  { key: 'documents', label: 'Dokümanlar', stage: 'Adım 1 · Girdi', hint: 'Kaynak dokümanları kaydedin. Revizyon değişirse bağlı satırlar yeniden değerlendirmeye düşer.' },
  { key: 'requirements', label: 'Gereksinimler', stage: 'Adım 1 · Girdi', hint: 'Her gereksinim benzersiz ID alır. Dokümandan AI ile çıkarabilirsiniz.' },
  { key: 'structure', label: 'Yapı & Fonksiyon', stage: 'Adım 2–3 · Yapı ve Fonksiyon Analizi', hint: 'Product → Assembly → Part → Feature → Function hiyerarşisi.' },
  { key: 'dfmea', label: 'DFMEA', stage: 'Adım 4–6 · Tasarım Hata, Risk, Optimizasyon', hint: 'Fonksiyon → Gereksinim → Hata Modu → Etki → Neden → Önleme → Tespit.' },
  { key: 'processSteps', label: 'Proses Akışı', stage: 'Adım 2 · Proses Yapısı', hint: 'Gerçek üretim akışını adım adım girin; özel prosesleri işaretleyin.' },
  { key: 'pfmea', label: 'PFMEA', stage: 'Adım 4–6 · Proses Hata, Risk, Optimizasyon', hint: 'DFMEA hata modlarını proses adımlarına bağlayın; kompozit kontrol listesini kullanın.' },
  { key: 'kcs', label: 'Kritik Karakteristikler', stage: 'KC Analizi', hint: 'AI Recommended KC adaylarını onaylayın veya reddedin. Onay kontrol planını oluşturur.' },
  { key: 'controlPlan', label: 'Kontrol Planı', stage: 'Kontrol Planı', hint: 'KC ve PFMEA’dan otomatik oluşur; ölçüm, sıklık ve reaksiyon planını tamamlayın.' },
  { key: 'msa', label: 'MSA', stage: 'Ölçüm Sistemi Analizi', hint: 'KC ölçümleri için Gage R&R, bias, linearity, stability, kalibrasyon.' },
  { key: 'capability', label: 'Yeterlilik', stage: 'Proses Yeterliliği', hint: 'Üretim verisini yapıştırın; Cp/Cpk/Pp/Ppk otomatik hesaplanır.' },
  { key: 'actions', label: 'Aksiyonlar', stage: 'Adım 6 · Optimizasyon', hint: 'FMEA’da önerilen aksiyonlar burada izlenir; iki yönlü senkronize.' },
  { key: 'issues', label: 'Açık Konular', stage: 'Eksik Bilgi', hint: 'Dokümanlardan çıkarılamayan bilgiler ve mühendislik soruları (Critical / Important / Optional).' },
  { key: 'traceability', label: 'İzlenebilirlik', stage: 'İzlenebilirlik', hint: 'Gereksinim → DFMEA → PFMEA → KC → Kontrol Planı bağlantıları ve boşluklar.' },
  { key: 'quality', label: 'Kalite Kontrol', stage: 'Adım 7 · Sonuç', hint: 'FMEA tamlık kontrolü ve mühendislik özeti. Kalite sertifikası değildir.' },
  { key: 'lessons', label: 'Dersler', stage: 'Lessons Learned', hint: 'NCR / 8D / CAPA kayıtlarını FMEA satırlarına bağlayın.' },
  { key: 'scoring', label: 'Puanlama', stage: 'Kriterler', hint: 'Severity / Occurrence / Detection kriterleri ve AP tablosu.' },
  { key: 'history', label: 'Revizyon', stage: 'Adım 7 · Dokümantasyon', hint: 'Rev A / B / C; eklenen, değişen ve silinen kayıtlar otomatik özetlenir.' },
];
