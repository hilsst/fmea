// Basılabilir FMEA inceleme raporu (HTML). Ana süreç PDF'e basar. Harici kaynak yok; tüm kullanıcı metni kaçışlanır.
import { verifyBaseline } from './baseline';
import { evaluateKc } from './kc';
import { QUALITY_SCORE_NOTE, qualityReport, whatDidIMiss } from './quality';
import { apOf, RPN_WARNING, rpn, type RiskLevel } from './scoring';
import { riskLevelOf } from './risk'; // v4-risk
import type { DfmeaRow, PfmeaRow, Project } from './types';
import { currentStep } from './workflow';

export interface AiReview {
  summary: string;
  findings: { category: string; severity: string; ids: string[]; finding: string; recommendation: string; confidence: string; basis: string }[];
  missed: { area: string; item: string; why: string; confidence: string }[];
}

export const REPORT_FOOTER = 'Bu rapor mühendislik değerlendirmesi içindir; AI önerileri mühendis onayı olmadan geçerli değildir.';

export function esc(v: unknown): string {
  const s = v == null ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RISK_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, '': 4 };
const has = (s: string | null | undefined) => !!s && s.trim() !== '' && !/^VERİ YOK/.test(s.trim());

function table(headers: string[], rows: unknown[][], empty = 'Kayıt yok'): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => (c && typeof c === 'object' && 'html' in (c as object) ? `<td>${(c as { html: string }).html}</td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/** Hazır (kaçışlanmış) HTML hücresi. */
const raw = (html: string) => ({ html });
const badge = (text: string, cls: string) => raw(`<span class="b ${cls}">${esc(text)}</span>`);
const apCls = (ap: string) => (ap === 'H' ? 'red' : ap === 'M' ? 'amber' : ap === 'L' ? 'green' : '');
const riskCls = (r: string) => (r === 'CRITICAL' || r === 'HIGH' ? 'red' : r === 'MEDIUM' ? 'amber' : r ? 'green' : '');

const CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; padding: 16px; background: #fff; }
h1 { font-size: 17pt; color: #1F3864; margin: 0 0 4px; }
h2 { font-size: 12.5pt; color: #1F3864; border-bottom: 2px solid #1F3864; padding-bottom: 2px; margin: 18px 0 6px; page-break-after: avoid; }
h3 { font-size: 10.5pt; margin: 10px 0 4px; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 8.5pt; }
th, td { border: 1px solid #bfbfbf; padding: 3px 5px; vertical-align: top; text-align: left; word-break: break-word; }
th { background: #1F3864; color: #fff; font-weight: 600; }
tr { page-break-inside: avoid; }
.meta td:first-child { font-weight: 600; width: 28%; background: #f2f2f2; }
.muted { color: #666; font-style: italic; }
.note { font-size: 8.5pt; color: #595959; font-style: italic; }
.score { font-size: 15pt; font-weight: 700; color: #1F3864; }
.b { display: inline-block; padding: 0 5px; border-radius: 3px; font-weight: 600; }
.red { background: #F8CBAD; } .amber { background: #FFE699; } .green { background: #C6EFCE; } .blue { background: #DDEBF7; }
.ai { border: 2px dashed #7030A0; padding: 6px 10px; margin-top: 10px; background: #faf7fd; }
.ai h2 { color: #7030A0; border-color: #7030A0; }
footer { margin-top: 18px; border-top: 1px solid #bfbfbf; padding-top: 6px; font-size: 8.5pt; color: #595959; }
@media print { body { padding: 0; } .ai { break-inside: auto; } }
`;

export function buildReviewReportHtml(p: Project, opts: { aiReview?: AiReview } = {}): string {
  const m = p.meta;
  const q = qualityReport(p);
  const today = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];
  const nameOf = m.partNumber || m.name || 'FMEA';

  parts.push(`<h1>FMEA İnceleme Raporu – ${esc(nameOf)} ${esc(m.fmeaRevision)}</h1>`);
  parts.push(`<p class="note">Oluşturma: ${esc(today)} · Güncel iş akışı adımı: ${esc(currentStep(p) ?? 'Tüm adımlar onaylandı')}</p>`);

  // Proje bilgileri
  const metaRows: [string, unknown][] = [
    ['Proje adı', m.name], ['Parça no / adı', [m.partNumber, m.partName].filter(Boolean).join(' – ')], ['Müşteri', m.customer], ['Program', m.program],
    ['FMEA no / revizyon', `${m.fmeaNumber} ${m.fmeaRevision}`.trim()], ['Resim revizyonu', m.drawingRevision], ['Hazırlayan / ekip', [m.preparedBy, m.team].filter(Boolean).join(' / ')],
    ['Tarihler', `${m.startDate} → ${m.revisionDate}`], ['Kapsam', m.scope], ['Ürün tipi', p.settings.productType],
    ['AI modu', p.settings.aiMode === 'knowledge' ? 'Engineering Knowledge Mode' : 'Strict Engineering Mode'],
    ['AP tablosu', p.scoring.apName || (p.scoring.apTable ? 'Şirket AP tablosu' : 'AIAG-VDA 2019')],
  ];
  parts.push('<h2>Proje Bilgileri</h2>');
  parts.push(`<table class="meta"><tbody>${metaRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${has(String(v ?? '')) ? esc(v) : '<span class="b amber">VERİ YOK – doğrulanmalı</span>'}</td></tr>`).join('')}</tbody></table>`);

  // Kalite skoru
  parts.push('<h2>FMEA Quality Score</h2>');
  parts.push(`<p class="score">${esc(q.label)}</p><p class="note">${esc(QUALITY_SCORE_NOTE)}</p>`);
  parts.push(table(['Boyut', 'Skor', 'Detay'], q.dimensions.map((d) => [d.label, d.applicable ? `${d.score}/100` : 'Veri yok', d.detail])));

  // Level 1
  parts.push('<h2>Level 1 – FMEA Kalite Kontrolleri</h2>');
  parts.push(table(['Kontrol', 'Sonuç', 'Detay', 'İlgili ID'], q.level1.map((c) => [c.question, badge(c.ok ? 'UYGUN' : 'EKSİK', c.ok ? 'green' : 'red'), c.detail, c.ids.slice(0, 30).join(', ') + (c.ids.length > 30 ? ` (+${c.ids.length - 30})` : '')])));

  // Level 2
  parts.push('<h2>Level 2 – Mühendislik Bulguları</h2>');
  const l2 = [...q.level2].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'FMEA LOGIC ERROR' ? -1 : 1));
  parts.push(table(['Tür', 'ID', 'Alan', 'Bulgu'], l2.map((f) => [badge(f.kind, f.kind === 'FMEA LOGIC ERROR' ? 'red' : 'amber'), f.id, f.field, f.message]), 'Mantık hatası veya mühendislik uyarısı bulunmadı'));

  // What did I miss
  parts.push('<h2>What did I miss? – Boşluk Analizi</h2>');
  parts.push(table(['Alan', 'Konu', 'İlgili ID'], whatDidIMiss(p).map((x) => [x.area, x.message, x.ids.join(', ')]), 'Boşluk bulunmadı'));

  // En yüksek riskler
  const fm: (DfmeaRow | PfmeaRow)[] = [...p.dfmea, ...p.pfmea].filter((r) => has(r.failureMode));
  const isScmhP = p.settings.scoringStandard === 'SCMH'; // v4-risk: SCMH'de AP gösterilmez
  const risks = fm
    .map((r) => ({ r, lvl: riskLevelOf(p, r), ap: isScmhP ? '' as const : apOf(p, r.s, r.o, r.d), rpn: rpn(r.s, r.o, r.d) }))
    .filter((x) => x.lvl)
    .sort((a, b) => RISK_ORDER[a.lvl] - RISK_ORDER[b.lvl] || (b.r.s ?? 0) - (a.r.s ?? 0) || (b.rpn ?? 0) - (a.rpn ?? 0))
    .slice(0, 20);
  parts.push('<h2>En Yüksek Riskler</h2>');
  parts.push(`<p class="note">Sıralama: risk seviyesi (emniyet/regülasyon > yüksek S > AP) ve Severity. ${esc(RPN_WARNING)}</p>`);
  parts.push(table(['ID', 'Hata Modu', 'Etki', 'Neden', 'S', 'O', 'D', 'AP', 'RPN', 'Risk', 'Önerilen Aksiyon'], risks.map((x) => [
    x.r.id, x.r.failureMode, x.r.effect, x.r.cause, x.r.s ?? '', x.r.o ?? '', x.r.d ?? '',
    x.ap ? badge(x.ap, apCls(x.ap)) : '', x.rpn ?? '', badge(x.lvl, riskCls(x.lvl)), x.r.recommendedAction || '—',
  ]), 'Puanlanmış hata modu yok'));

  // KC
  parts.push('<h2>Özel / Kritik Karakteristikler</h2>');
  parts.push(table(['KC', 'Kaynak', 'Karakteristik', 'Sınıf / Kategori', 'Faktörler', 'Öneri', 'Mühendis Kararı'], p.kcs.map((k) => {
    const src = p.dfmea.find((d) => d.id === k.sourceId) ?? p.pfmea.find((x) => x.id === k.sourceId);
    const ev = src ? evaluateKc(p, src, k) : null;
    const st = k.status || 'Değerlendirilmedi';
    return [
      k.id, k.sourceId, k.characteristic, [k.kcClass, k.category].filter(Boolean).join(' / '),
      ev ? ev.factors.filter((f) => f.on).map((f) => `${f.label}${f.reason ? ` (${f.reason})` : ''}`).join('; ') || 'Faktör yok' : 'Kaynak FMEA satırı bulunamadı',
      ev?.suggestedCategory ? `${ev.suggestedCategory} (AI SUGGESTION)` : '',
      badge(st, st === 'Approved' ? 'green' : st === 'Rejected' ? 'red' : 'amber'),
    ];
  }), 'KC tanımlı değil'));

  // Kontrol planı boşlukları
  const cpGaps: [string, string, string][] = [];
  for (const k of p.kcs.filter((k) => k.status !== 'Rejected' && !p.controlPlan.some((c) => c.kcId === k.id)))
    cpGaps.push([k.id, k.characteristic, 'Kontrol planında karşılığı yok (Control Plan Gap)']);
  for (const c of p.controlPlan) {
    const miss = [['method', 'ölçüm yöntemi'], ['sampleSize', 'örnek'], ['frequency', 'sıklık'], ['reactionPlan', 'reaksiyon planı']]
      .filter(([k]) => !has((c as unknown as Record<string, string>)[k]))
      .map(([, l]) => l);
    if (miss.length) cpGaps.push([c.id, c.productChar || c.processChar, `Eksik: ${miss.join(', ')}`]);
  }
  parts.push('<h2>Kontrol Planı Boşlukları</h2>');
  parts.push(table(['ID', 'Karakteristik', 'Boşluk'], cpGaps, 'Kontrol planı boşluğu bulunmadı'));

  // Açık aksiyonlar
  const open = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled');
  parts.push('<h2>Açık Aksiyonlar</h2>');
  parts.push(table(['ID', 'Kaynak', 'Aksiyon', 'Sorumlu', 'Termin', 'Durum'], open.map((a) => {
    const late = !!a.dueDate && a.dueDate < today;
    return [a.id, a.sourceId, a.description, a.owner || 'VERİ YOK', late ? badge(`${a.dueDate} – GECİKMİŞ`, 'red') : a.dueDate || 'VERİ YOK', a.status];
  }), 'Açık aksiyon yok'));

  // AI review
  const ai = opts.aiReview;
  if (ai) {
    parts.push('<section class="ai"><h2>AI REVIEW – öneri, onay değildir</h2>');
    parts.push(`<p>${esc(ai.summary)}</p>`);
    parts.push('<h3>Bulgular</h3>');
    parts.push(table(['Kategori', 'Önem', 'ID', 'Bulgu', 'Öneri', 'Güven', 'Dayanak'], (ai.findings ?? []).map((f) => [f.category, f.severity, f.ids, f.finding, f.recommendation, f.confidence, f.basis]), 'Bulgu yok'));
    parts.push('<h3>Gözden kaçmış olabilecekler</h3>');
    parts.push(table(['Alan', 'Konu', 'Neden önemli', 'Güven'], (ai.missed ?? []).map((x) => [x.area, x.item, x.why, x.confidence]), 'Öneri yok'));
    parts.push('</section>');
  }

  // Onaylar ve baseline'lar
  parts.push('<h2>Onaylar ve Baseline’lar</h2>');
  parts.push(table(['Kayıt', 'Adım', 'Rol', 'Kullanıcı', 'Zaman', 'Karar', 'Yorum', 'Revizyon'], p.approvals.map((a) => [a.id, a.step, a.role, a.user, a.at, a.decision, a.comment, a.revision]), 'Onay kaydı yok'));
  parts.push(table(['Baseline', 'Revizyon', 'Yazar', 'Tarih', 'Onaylayan', 'Değişiklik nedeni', 'Mühür'], p.baselines.map((b) => {
    const ok = verifyBaseline(b);
    return [b.id, b.revision, b.author, b.date, b.approver, b.changeReason, badge(ok ? 'Mühür geçerli' : 'MÜHÜR BOZUK', ok ? 'green' : 'red')];
  }), 'Baseline yok'));

  parts.push(`<footer>${esc(REPORT_FOOTER)}</footer>`);

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FMEA İnceleme Raporu – ${esc(nameOf)}</title>
<style>${CSS}</style></head>
<body>
${parts.join('\n')}
</body></html>`;
}
