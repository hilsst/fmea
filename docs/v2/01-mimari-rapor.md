# FMEA Studio 1.0 → 2.0 Mimari Raporu (Faz 1)

Tarih: 2026-10-19 · Kaynak: `main` dalı, commit `a0eefeb`

## CURRENT ARCHITECTURE

| Katman | Dosya | Görev |
|---|---|---|
| Electron ana süreç | `src/main/main.ts` | Pencere, Türkçe menü, IPC (proje aç/kaydet/son açılanlar/kurtarma, Excel, dosya seçme, AI), API anahtarı (`safeStorage`) |
| Preload | `src/main/preload.ts` | `window.api` beyaz listesi (contextBridge) |
| AI | `src/main/ai.ts` | Anthropic SDK, tek SYSTEM prompt; gereksinim çıkarma (PDF/görsel/xlsx/metin), DFMEA önerisi, PFMEA önerisi, mühendislik özeti; JSON schema çıktısı |
| Ortak model | `src/shared/types.ts`, `model.ts` | 14 tablo (DOC, REQ, FN, DF, OP, PF, KC, CP, MSA, CAP, ACT, OI, LL, CH), varsayılanlar, puanlama kriterleri, listeler, kompozit kontrol listesi |
| Yayılma motoru | `src/shared/engine.ts` | `planEdits` → kopya projede değişiklik + kural kuyruğu + `Effect` listesi; `crossScreenEffects` onay penceresi için |
| Puanlama | `src/shared/scoring.ts` | AIAG-VDA AP, RPN, risk seviyesi, KC adaylığı, Cp/Cpk/Pp/Ppk |
| Kalite / izlenebilirlik | `src/shared/checks.ts` | 17 ağırlıklı kontrol, tamlık skoru, 10 izlenebilirlik matrisi |
| Kolonlar | `src/shared/columns.ts` | Ekran ve Excel için ortak kolon tanımı |
| Excel | `src/shared/excel.ts` | 18 sayfalık exceljs çıktısı |
| Arayüz | `src/renderer/*` | React 18; `store.tsx` (onay penceresi, geri al/yinele, otomatik yedek), `Grid`, hücre bileşenleri, 18 sekme |
| Test | `tests/engine.test.ts`, `tests/e2e/smoke.mjs` | 14 birim testi, Electron uçtan uca duman testi |
| CI | `.github/workflows/build.yml` | Ubuntu test + Windows NSIS/portable paketi |

## CURRENT FEATURES

- 18 sekme çalışma sırasıyla; ekranlar arası değişikliklerde onay penceresi (tümünü güncelle / sadece bu ekran / vazgeç).
- Yayılma kuralları: doküman revizyonu → yeniden değerlendirme; gereksinim → DFMEA/KC; fonksiyon → DFMEA; DFMEA S → PFMEA S ve KC; KC adayı ekle/kaldır; KC onayı → CP + MSA + capability; PFMEA kontrolleri → CP; proses adımı → PFMEA/CP; FMEA ↔ aksiyon iki yönlü; silme zincirleri.
- AI: gereksinim çıkarma, DFMEA/PFMEA önerisi, mühendislik özeti; öneriler "AI Proposed".
- Kalite kontrol (17 madde), tamlık skoru, izlenebilirlik matrisleri, revizyon geçmişi (Added/Modified/Deleted).
- Excel (18 sayfa), `.fmea` JSON dosyası (`schemaVersion: 1`), kurtarma dosyası, son açılanlar.

## CURRENT DATA MODEL

`Project = { schemaVersion: 1, meta, settings, scoring, documents, requirements, structure, dfmea, processSteps, pfmea, kcs, controlPlan, msa, capability, actions, issues, lessons, history, changeLog }`. Satırlar ID ile bağlanır (`reqIds`, `functionId`, `dfIds`, `stepId`, `sourceId`, `kcId`, `pfId`, `cpId`, `actionId`, `linkedFmeaIds`).

## CURRENT LIMITATIONS

1. DOCX, PPTX, EML, MSG, DXF, STEP, IGES ayrıştırılmıyor; PDF yalnızca AI’ye gönderiliyor, yerel metin çıkarımı yok.
2. Kanıt sistemi yok: kaynak serbest metin, sayfa/hücre/balon ayrı tutulmuyor, AI kaynağı doğrulanmıyor.
3. Gereksinimde nominal/alt/üst limit/birim yok.
4. S/O/D için gerekçe, kriter, kanıt, güven saklanmıyor.
5. PFMEA’da 4M/5M, 5 Neden, proses elemanı yok; özel proses parametresi modeli yok.
6. KC yalnızca severity eşiğine ve özel karakteristik alanına bağlı.
7. Capability’de normallik, kararlılık, alt grup, yeterlilik kararı yok.
8. Baseline, onay iş akışı, denetim izi (audit trail) yok; revizyon yalnızca özet.
9. Anlamsal FMEA doğrulaması (failure/effect/cause karışıklığı) yok.
10. AI tek prompt; üretici ve denetçi ayrı değil; sağlayıcı soyutlaması yok; önbellek ve parçalama (chunking) yok.
11. Excel içe aktarma, şirket şablonu, HTML/PDF rapor yok.
12. Güvenlik: `sandbox: false`, CSP yok; `safeStorage` yoksa API anahtarı Base64 düz metin saklanıyor.
13. Büyük tablolarda tüm satırlar aynı anda çiziliyor.

## PROPOSED ARCHITECTURE

```
Renderer (React, sandbox)          Main (Electron)                   Shared (saf TS, test edilir)
 ├ Sol menü (§46, 20 ekran)        ├ docintel/  PDF·DOCX·XLSX·CSV·    ├ types.ts (schema v2)
 ├ Grid (artımlı çizim)            │   PPTX·TXT·EML·MSG·DXF·STEP·IGES ├ migrate.ts (v1 → v2)
 ├ Onay penceresi + neden          │   (worker thread)                ├ engine.ts (yayılma + denetim izi)
 ├ AI öneri penceresi              ├ ai/ provider.ts (Anthropic,      ├ evidence.ts, impact.ts
 │  (Kabul / Düzenle / Reddet)     │   OpenAI*, Local*), roles.ts,    ├ semantic.ts, quality.ts
 ├ "Bu bilgi nereden geldi?"       │   schema doğrulama, retry, cache ├ kc.ts, capability.ts, scoring.ts
 └ İzlenebilirlik grafiği          ├ connectors/ifs (opsiyonel, mock) ├ kb.ts (kompozit bilgi tabanı)
                                   └ report (HTML/PDF), Excel v1+v2   ├ lessons.ts (benzerlik)
                                                                      └ excel.ts, excel2.ts, report.ts
```
\* OpenAI ve yerel model arayüzü hazır, bağlantısı bu sürümde yok (NOT SUPPORTED olarak gösterilir).

Katmanlar: Document Intelligence → Requirement → DFMEA → PFMEA → Risk → Special Characteristic → Control Plan → MSA → Capability → Action → Quality Validation → AI Review → Engineer Approval; üstte Project, Revision, Baseline, Traceability, Evidence, Change Impact, Lessons Learned, Knowledge Base.

## MIGRATION PLAN

1. `schemaVersion: 2`. Açılışta `migrate()` çalışır: v1 (veya sürümsüz) dosya → v2. Yeni alanlar boş değerle eklenir, eski alanlar silinmez; `source` metni korunur, `documents` + `evidence` tabloları eklenir; eski `history` satırları korunur.
2. Yeni tablolar: `evidence (EV)`, `processParams (PP)`, `changeRequests (CR)`, `aiRuns (AIR)`; yeni koleksiyonlar: `baselines`, `approvals`, `auditLog`, `docIndex`.
3. Migration testleri: `tests/fixtures/v1-sample.fmea` (1.0 örnek projesi) ve `v1-minimal.fmea` (eksik alanlı eski dosya) açılır; hiçbir değer kaybolmaz.
4. Her fazdan sonra: `npm run typecheck`, `npm test`, `npm run build`, Electron duman testi.
