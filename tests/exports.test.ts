import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbookV2 } from '../src/shared/excel2';
import { applyImport, COMPUTED, detectHeaderRow, IMPORT_TARGETS, suggestMapping, type SheetGrid } from '../src/shared/importmap';
import { DEFAULT_SCORING } from '../src/shared/model';
import { buildReviewReportHtml } from '../src/shared/report';
import { sampleProject } from '../src/shared/sample';
import { applyTemplate, makeTemplate, validateTemplate, type CompanyTemplate } from '../src/shared/template';
import type { PfmeaRow } from '../src/shared/types';

const SHEETS = [
  '01_Project Summary', '02_Requirements', '03_DFMEA', '04_PFMEA', '05_Special Characteristics', '06_Control Plan', '07_MSA',
  '08_Capability', '09_Actions', '10_Lessons Learned', '11_Traceability', '12_AI Evidence', '13_Change History', '14_Approval',
];

describe('Excel v2 (14 sayfa)', () => {
  it('writes the 14 sheets in order with DFMEA content', async () => {
    const p = sampleProject();
    const buf = await buildWorkbookV2(p);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(SHEETS);
    const values: string[] = [];
    wb.getWorksheet('03_DFMEA')!.eachRow((r) => r.eachCell((c) => values.push(String(c.value ?? ''))));
    expect(values).toContain(p.dfmea[0].failureMode);
    const summary: string[] = [];
    wb.getWorksheet('01_Project Summary')!.eachRow((r) => r.eachCell((c) => summary.push(String(c.value ?? ''))));
    expect(summary.some((s) => s.startsWith('FMEA Quality Score'))).toBe(true);
    expect(summary).toContain('AIAG-VDA 2019');
    // ham nesne yazılmaz
    for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => expect(String(c.value)).not.toContain('[object Object]')));
    const pf: string[] = [];
    wb.getWorksheet('04_PFMEA')!.eachRow((r) => r.eachCell((c) => pf.push(String(c.value ?? ''))));
    expect(pf).toContain('Proses Parametreleri (Special Process Engine)');
  });
});

const aiag: SheetGrid = {
  name: 'PFMEA',
  rows: [
    ['POTENTIAL FAILURE MODE AND EFFECTS ANALYSIS (PROCESS FMEA)', null, null, null, null, null, null, null, null, null],
    ['FMEA Number: 123', null, 'Page 1 of 1', null, null, null, null, null, null, null],
    ['Process Step', 'Potential Failure Mode', 'Potential Effect(s) of Failure', 'SEV', 'Potential Cause(s)', 'OCC', 'Current Process Controls Prevention', 'Current Process Controls Detection', 'DET', 'RPN'],
    ['Machining', 'Hole oversize', 'Montaj gevşek', 8, 'Yanlış matkap', 'x', 'Takım kontrolü', 'Tapa mastar', '5', 200],
    [null, null, null, null, null, null, null, null, null, null],
    ['Paketleme', 'Ezik', 'Görünüm', '4', 'Yetersiz koruma', 3, '', 'Görsel', 11, 132],
  ],
};

describe('Excel FMEA içe aktarma', () => {
  it('detects header, suggests mapping and imports without mutating the project', () => {
    const p = sampleProject();
    const before = JSON.stringify(p);
    const h = detectHeaderRow(aiag);
    expect(h).toBe(2);
    const map = suggestMapping(aiag.rows[h].map((x) => String(x ?? '')), 'pfmea');
    expect(map).toEqual({ 0: 'stepName', 1: 'failureMode', 2: 'effect', 3: 's', 4: 'cause', 5: 'o', 6: 'prevention', 7: 'detection', 8: 'd', 9: COMPUTED });
    expect(IMPORT_TARGETS.pfmea.some((t) => t.key === 'rpn' || t.key === 'ap')).toBe(false);

    const res = applyImport(p, 'pfmea', aiag, h, map, { sourceLabel: 'eski_fmea.xlsx' });
    expect(JSON.stringify(p)).toBe(before);
    expect(res.rows.map((r) => r.id)).toEqual(['PF-003', 'PF-004']);
    const [a, b] = res.rows as PfmeaRow[];
    expect(a).toMatchObject({ failureMode: 'Hole oversize', s: 8, o: null, d: 5, origin: 'import', approval: '', dataStatus: '' });
    expect(a.source).toBe('eski_fmea.xlsx / PFMEA / satır 4');
    // adım adı projedeki proses adımıyla eşleşir
    expect(a.stepId).toBe('OP-003');
    expect(b).toMatchObject({ s: 4, o: 3, d: null, stepId: '' });
    expect(res.warnings.some((w) => w.startsWith('F4:'))).toBe(true);
    expect(res.warnings.some((w) => w.startsWith('I6:'))).toBe(true);
    expect(res.warnings.filter((w) => /RPN/.test(w))).toHaveLength(1);
  });

  it('maps Turkish headers', () => {
    const m = suggestMapping(['Fonksiyon', 'Hata Modu', 'Etki', 'Neden', 'Önleme', 'Tespit', 'S', 'O', 'D', 'AP', 'Önerilen Aksiyon', 'Sorumlu', 'Target Date'], 'dfmea');
    expect(Object.values(m)).toEqual(['function', 'failureMode', 'effect', 'cause', 'prevention', 'detection', 's', 'o', 'd', COMPUTED, 'recommendedAction', 'owner', 'dueDate']);
  });
});

describe('Şirket şablonu', () => {
  it('round-trips through JSON and keeps rows identical', () => {
    const p = sampleProject();
    p.settings.kcSeverityThreshold = 8;
    p.settings.targetCpk = 1.67;
    p.scoring = { ...structuredClone(DEFAULT_SCORING), apName: 'Şirket AP Rev 2', apTable: { '4,3': 'HHHH' } };
    const t = JSON.parse(JSON.stringify(makeTemplate(p, 'Şirket Standardı'))) as CompanyTemplate;
    expect(validateTemplate(t)).toEqual([]);

    const target = sampleProject();
    const rowsBefore = JSON.stringify({ ...target, settings: null, scoring: null });
    const out = applyTemplate(target, t);
    expect(JSON.stringify({ ...out, settings: null, scoring: null })).toBe(rowsBefore);
    expect(out.dfmea).toBe(target.dfmea);
    expect(out.settings.kcSeverityThreshold).toBe(8);
    expect(out.settings.targetCpk).toBe(1.67);
    expect(out.scoring.apName).toBe('Şirket AP Rev 2');
    expect(target.settings.kcSeverityThreshold).toBe(9);
  });

  it('reports errors for invalid templates', () => {
    expect(validateTemplate(null).length).toBeGreaterThan(0);
    const bad = { kind: 'x', version: 2, name: '', createdAt: 1, settings: { kcSeverityThreshold: 42, userName: 'a' }, scoring: { severity: [], occurrence: [], detection: [], apTable: { '9,9': 'ZZ' } } };
    const e = validateTemplate(bad);
    expect(e.length).toBeGreaterThanOrEqual(7);
    expect(e.some((x) => x.startsWith('settings.userName'))).toBe(true);
    expect(() => applyTemplate(sampleProject(), bad as unknown as CompanyTemplate)).toThrow();
  });
});

describe('İnceleme raporu (HTML)', () => {
  it('contains quality score and escapes user text', () => {
    const p = sampleProject();
    p.dfmea[0].failureMode = '<script>alert(1)</script>';
    const html = buildReviewReportHtml(p, {
      aiReview: { summary: 'Özet <b>', findings: [{ category: 'Logic', severity: 'Major', ids: ['DF-001'], finding: 'x', recommendation: 'y', confidence: 'Low', basis: 'AI INFERENCE' }], missed: [] },
    });
    expect(html).toContain('FMEA Quality Score');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('AI REVIEW – öneri, onay değildir');
    expect(html).toContain('Bu rapor mühendislik değerlendirmesi içindir; AI önerileri mühendis onayı olmadan geçerli değildir.');
    expect(html).not.toMatch(/<link|src=/);
  });
});
