// SCMH şablon doldurma testleri. IAQG şablonları © IAQG olduğundan depoda yoktur: testler aynı sayfa
// adları ve hücre konumlarıyla exceljs'te üretilen küçük sentetik şablonlar kullanır.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { blankRow, newProject, normalizeProject, DEFAULT_SCORING } from '../src/shared/model';
import { buildScmhPackage, SCMH_FILE_NAMES, SCMH_LAYOUT, SCMH_HEADER, VY, scmhFileName, type ScmhKind } from '../src/shared/scmh';
import { ScmhBook, col2n, n2col } from '../src/shared/scmhfill';
import { SCMH_SCORING, scmhPriority, scmhSort, scmhClassOptions } from '../src/shared/scmhScoring';
import type { ControlPlanRow, DfmeaRow, HistoryRow, KcRow, PfmeaRow, ProcessParamRow, ProcessStepRow, Project, RequirementRow, StructureRow } from '../src/shared/types';

const CAP = 5; // sentetik şablondaki veri satırı sayısı
const REV_FOOTER = 10; // Revision History alt bilgi satırı (4..9 kullanılabilir)

const FORMULAS: Partial<Record<ScmhKind, Record<string, (r: number) => string>>> = {
  dfmea: { N: (r) => `H${r}*K${r}`, O: (r) => `H${r}*K${r}*M${r}`, Y: (r) => `V${r}*W${r}`, Z: (r) => `V${r}*W${r}*X${r}` },
  pfmea: { O: (r) => `I${r}*L${r}`, P: (r) => `I${r}*L${r}*N${r}`, Z: (r) => `W${r}*X${r}*Y${r}` },
};

const SHAPES: Partial<Record<ScmhKind, number[]>> = { dfmea: [68609, 68610, 68611], pfmea: [72705, 72706], cp: [20497, 20536] };

/** Sentetik şablon: aynı sayfa adları, başlık/tablo hücre konumları, formüller, alt bilgi, checkbox ve ek parçalar. */
async function fixture(kind: ScmhKind): Promise<Uint8Array> {
  const L = SCMH_LAYOUT[kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheet);
  ws.getCell('B2').value = `${kind.toUpperCase()} (synthetic template)`;
  for (const ref of Object.values(SCMH_HEADER[kind])) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref!)!;
    ws.getCell(`${m[1]}${Number(m[2]) - 1}`).value = 'Label:';
  }
  ws.getCell(`B${L.first - 1}`).value = 'Doc (Line) #';
  for (let i = 0; i < CAP; i++) {
    const r = L.first + i;
    const c = ws.getCell(`B${r}`);
    c.value = i + 1;
    c.style = { font: { bold: true }, border: { top: { style: 'thin' } } };
    for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']) ws.getCell(`${col}${r}`).border = { bottom: { style: 'thin' } };
    for (const [col, f] of Object.entries(FORMULAS[kind] ?? {})) ws.getCell(`${col}${r}`).value = { formula: f(r), result: 0 };
  }
  ws.getCell(`B${L.first + CAP}`).value = '© 20XX IAQG synthetic footer';
  if (kind === 'dfmea') ws.addConditionalFormatting({ ref: `H${L.first}:H${L.first + CAP - 1}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['8'], priority: 1, style: { font: { bold: true } } }] });
  if (kind === 'cp') ws.pageSetup.printArea = `B2:O${L.first + CAP - 1}`;
  const rev = wb.addWorksheet(L.revSheet);
  rev.getCell('A2').value = 'Revision History';
  ['Date', 'Rev', 'Revision Summary', 'Approval'].slice(0, L.revCols.length).forEach((h, i) => (rev.getCell(3, i + 1).value = h));
  if (kind === 'pfmea') ['05/01/25', 'A', 'Template revision (prefilled row)'].forEach((v, i) => (rev.getCell(4, i + 1).value = v));
  rev.getCell(`A${REV_FOOTER}`).value = '© 20XX IAQG synthetic footer';
  wb.addWorksheet('Guidance').getCell('A1').value = 'guidance text';
  const buf = await wb.xlsx.writeBuffer();

  // jszip ile exceljs'in bilmediği parçalar: form kontrolleri (ctrlProp + VML), çizim, external link, ikili medya
  const zip = await JSZip.loadAsync(buf);
  zip.file('xl/externalLinks/externalLink1.xml', '<?xml version="1.0"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook/></externalLink>');
  zip.file('xl/drawings/drawing99.xml', '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><!-- shapes --></xdr:wsDr>');
  zip.file('xl/media/image1.bin', new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
  const shapes = SHAPES[kind] ?? [];
  if (shapes.length) {
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
    let rels = (await zip.file(relsPath)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let controls = '';
    let vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">';
    shapes.forEach((id, i) => {
      zip.file(`xl/ctrlProps/ctrlProp${i + 1}.xml`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="CheckBox" lockText="1" noThreeD="1"/>');
      rels = rels.replace('</Relationships>', `<Relationship Id="rIdC${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp" Target="../ctrlProps/ctrlProp${i + 1}.xml"/></Relationships>`);
      controls += `<control shapeId="${id}" r:id="rIdC${i}" name="Check Box ${i + 1}"/>`;
      vml += `<v:shape id="_x0000_s${id}" type="#_x0000_t201"><x:ClientData ObjectType="Checkbox"><x:Anchor>1, 0, 1, 0, 2, 0, 2, 0</x:Anchor></x:ClientData></v:shape>`;
    });
    zip.file('xl/drawings/vmlDrawing1.vml', vml + '</xml>');
    rels = rels.replace('</Relationships>', '<Relationship Id="rIdV" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>');
    zip.file(relsPath, rels);
    let sx = await zip.file(sheetPath)!.async('string');
    if (!sx.includes('xmlns:r=')) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    zip.file(sheetPath, sx.replace('</worksheet>', `<controls>${controls}</controls></worksheet>`));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

function row<T>(table: Parameters<typeof blankRow>[0], id: string, data: Partial<T>): T {
  return { ...(blankRow(table, id) as object), ...data, id } as T;
}

function project(): Project {
  const p = newProject();
  p.meta = { ...p.meta, partNumber: 'P-100', partName: 'Bracket', program: 'Prog X', fmeaNumber: 'FM-1', fmeaRevision: 'Rev B', organization: 'ACME Aero', location: 'Ankara', exportControl: 'None', scope: 'Bracket design and manufacture', startDate: '2026-01-02', revisionDate: '2026-10-20', team: 'A (DE), B (PE)', productOwner: 'Owner <o@x.com>', processOwner: 'Proc <p@x.com>', facilitator: 'Fac', dfmeaLevel: 'Component', scmhPhase: 'Production' };
  p.structure = [row<StructureRow>('structure', 'FN-001', { level: 'Component', element: 'Bracket', function: 'Carries load' })];
  p.requirements = [row<RequirementRow>('requirements', 'REQ-001', { text: 'Load 5 kN' })];
  p.dfmea = Array.from({ length: CAP + 2 }, (_, i) =>
    row<DfmeaRow>('dfmea', `DF-${String(i + 1).padStart(3, '0')}`, {
      functionId: 'FN-001',
      reqIds: ['REQ-001'],
      failureMode: `Mode ${i + 1}`,
      effect: 'Loss of function',
      localEffect: i === 0 ? 'Crack' : '',
      cause: i === 1 ? '' : `Cause ${i + 1}`,
      prevention: '=SUM(A1:A9) is text, not a formula',
      detection: 'Test',
      s: i === 2 ? null : 7,
      o: 3,
      d: 4,
      recommendedAction: i === 0 ? 'Add rib' : '',
    }),
  );
  p.kcs = [row<KcRow>('kcs', 'KC-001', { sourceId: 'DF-001', status: 'Approved' }), row<KcRow>('kcs', 'KC-002', { sourceId: 'DF-002', status: 'Rejected' })];
  p.processSteps = [
    row<ProcessStepRow>('processSteps', 'OP-001', { opNo: '20', name: 'Machining', description: 'Drill holes', stepType: ['Operation', 'Inspect/Test'] }),
    row<ProcessStepRow>('processSteps', 'OP-002', { opNo: '10', name: 'Storage', description: 'Store blanks' }),
    row<ProcessStepRow>('processSteps', 'OP-003', { opNo: '30', name: 'Özel adım', description: 'Custom', stepType: ['Other'], stepTypeOther: 'Admin' }),
    row<ProcessStepRow>('processSteps', 'OP-004', { opNo: '40', name: 'Tanımsız', description: 'No type' }),
  ];
  p.pfmea = [
    row<PfmeaRow>('pfmea', 'PF-001', { stepId: 'OP-001', processFunction: 'Drill', requirement: 'Ø6.0 +0.1', failureMode: 'Oversize', effect: 'Scrap', cause: 'Wear', prevention: 'Tool life', detection: 'Gauge', s: 8, o: 4, d: 5 }),
    row<PfmeaRow>('pfmea', 'PF-002', { stepId: 'OP-001', processFunction: 'Drill', requirement: 'Spindle 3000 rpm', failureMode: 'Burn', effect: 'Rework', cause: 'Speed', prevention: '', detection: 'Visual', s: 5, o: 3, d: 8 }),
  ];
  p.processParams = [row<ProcessParamRow>('processParams', 'PP-001', { stepId: 'OP-001', parameter: 'Spindle', pfIds: ['PF-002'] })];
  p.controlPlan = Array.from({ length: CAP + 1 }, (_, i) =>
    row<ControlPlanRow>('controlPlan', `CP-${String(i + 1).padStart(3, '0')}`, { stepId: 'OP-001', productChar: `Char ${i + 1}`, kcId: i === 0 ? 'KC-001' : '', specification: 'Ø6.0', tolerance: '+0.1/0', method: 'Plug gauge', frequency: '100%', controlMethod: 'Inspection', reactionPlan: 'Quarantine', reference: 'DRW-1 zone B2' }),
  );
  p.history = Array.from({ length: 8 }, (_, i) => row<HistoryRow>('history', `CH-${String(i + 1).padStart(3, '0')}`, { revision: `Rev ${String.fromCharCode(65 + i)}`, date: `2026-0${(i % 9) + 1}-01`, description: i === 3 ? '' : `Change ${i + 1}`, added: i === 3 ? 'DF-004' : '', approvedBy: i === 0 ? 'QA' : '' }));
  return p;
}

async function templates() {
  return { pfd: await fixture('pfd'), dfmea: await fixture('dfmea'), pfmea: await fixture('pfmea'), cp: await fixture('cp') };
}

async function entries(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const z = await JSZip.loadAsync(buf);
  const m = new Map<string, Uint8Array>();
  for (const [n, f] of Object.entries(z.files)) if (!f.dir) m.set(n, await f.async('uint8array'));
  return m;
}

describe('scmhfill', () => {
  it('col helpers round-trip', () => {
    for (const n of [1, 26, 27, 28, 52, 702, 703]) expect(col2n(n2col(n))).toBe(n);
    expect(n2col(28)).toBe('AB');
  });

  it('sets values, keeps style, inline strings, formulas only by object', async () => {
    const b = await ScmhBook.open(await fixture('dfmea'));
    const s18 = b.styleOf('DFMEA', 'B18');
    b.set('DFMEA', 'B18', 42);
    b.set('DFMEA', 'C18', '=1+1');
    b.set('DFMEA', 'AC18', 'new', { styleFrom: 'B18' });
    b.set('DFMEA', 'D18', { formula: 'B18*2' });
    const out = await ScmhBook.open(await b.save());
    expect(out.get('DFMEA', 'B18')).toBe(42);
    expect(out.styleOf('DFMEA', 'B18')).toBe(s18);
    expect(out.get('DFMEA', 'C18')).toBe('=1+1'); // metin olarak (inline string)
    expect(out.styleOf('DFMEA', 'AC18')).toBe(s18);
    expect(out.get('DFMEA', 'D18')).toBe('=B18*2');
    const xml = new TextDecoder().decode((await entries(await out.save())).get('xl/worksheets/sheet1.xml')!);
    expect(xml).toMatch(/<c r="C18"[^>]*t="inlineStr"/);
  });
});

describe('buildScmhPackage (synthetic templates)', () => {
  it('fills the four templates', async () => {
    const tpl = await templates();
    const p = project();
    const out = await buildScmhPackage(p, tpl);
    expect(Object.keys(out).sort()).toEqual(['cp', 'dfmea', 'pfd', 'pfmea']);

    // ---------- DFMEA
    const df = await ScmhBook.open(out.dfmea);
    expect(df.get('DFMEA', 'B5')).toBe('ACME Aero');
    expect(df.get('DFMEA', 'H5')).toBe('None');
    expect(df.get('DFMEA', 'H7')).toBe(VY); // other restrictions yok
    expect(df.get('DFMEA', 'T10')).toBe('FM-1 Rev B');
    expect(df.get('DFMEA', 'G12')).toBe('Owner <o@x.com>');
    expect(df.get('DFMEA', 'C18')).toBe('Bracket');
    expect(df.get('DFMEA', 'D18')).toBe('Carries load');
    expect(df.get('DFMEA', 'E18')).toBe('REQ-001: Load 5 kN');
    expect(df.get('DFMEA', 'F18')).toBe('Mode 1');
    expect(df.get('DFMEA', 'G18')).toBe('(L) Crack\n(E) Loss of function');
    expect(df.get('DFMEA', 'H18')).toBe(7);
    expect(df.get('DFMEA', 'J18')).toBe('=SUM(A1:A9) is text, not a formula');
    expect(df.get('DFMEA', 'P18')).toBe('KC-001');
    expect(df.get('DFMEA', 'P19')).toBe(null); // reddedilmiş KC yazılmaz
    expect(df.get('DFMEA', 'Q18')).toBe('Add rib');
    expect(df.get('DFMEA', 'R18')).toBe(VY); // aksiyon var, sorumlu yok
    expect(df.get('DFMEA', 'R19')).toBe(null); // aksiyon yok → boş
    expect(df.get('DFMEA', 'I19')).toBe(VY); // neden yok
    expect(df.get('DFMEA', 'H20')).toBe(VY); // S yok
    // satır ekleme: 7 satır > 5 şablon satırı → alt bilgi 2 satır aşağı
    expect(df.get('DFMEA', 'B24')).toBe(7);
    expect(df.get('DFMEA', 'F24')).toBe('Mode 7');
    expect(String(df.get('DFMEA', 'B25'))).toMatch(/^©/);
    // formüller korunur (yeni satırlarda da), önbellek değeri silinir
    expect(df.get('DFMEA', 'O18')).toBe('=H18*K18*M18');
    expect(df.get('DFMEA', 'N23')).toBe('=H23*K23');
    expect(df.get('DFMEA', 'O24')).toBe('=H24*K24*M24');
    expect(df.get('DFMEA', 'Z24')).toBe('=V24*W24*X24');
    const dfe = await entries(out.dfmea);
    const sheet = new TextDecoder().decode(dfe.get('xl/worksheets/sheet1.xml')!);
    expect(sheet).not.toMatch(/<\/f><v>/);
    expect(sheet).toContain('sqref="H18:H24"');
    expect(sheet).not.toContain('[object Object]');
    // checkbox: Component (68610 → ctrlProp2)
    expect(new TextDecoder().decode(dfe.get('xl/ctrlProps/ctrlProp2.xml')!)).toContain('checked="Checked"');
    expect(new TextDecoder().decode(dfe.get('xl/ctrlProps/ctrlProp1.xml')!)).not.toContain('checked=');
    expect(new TextDecoder().decode(dfe.get('xl/drawings/vmlDrawing1.vml')!)).toMatch(/_x0000_s68610.*<x:Checked>1<\/x:Checked><\/x:ClientData>/s);
    expect(new TextDecoder().decode(dfe.get('xl/workbook.xml')!)).toContain('fullCalcOnLoad="1"');
    // revizyon geçmişi: 8 satır, 4..9 sığmaz → satır eklenir
    expect(df.get('Revision History', 'A4')).toBe('2026-01-01');
    expect(df.get('Revision History', 'B4')).toBe('Rev A');
    expect(df.get('Revision History', 'D4')).toBe('QA');
    expect(df.get('Revision History', 'D5')).toBe(VY);
    expect(df.get('Revision History', 'C7')).toBe('Eklenen: DF-004');
    expect(df.get('Revision History', 'B11')).toBe('Rev H');
    expect(String(df.get('Revision History', 'A12'))).toMatch(/^©/);

    // ---------- PFMEA
    const pf = await ScmhBook.open(out.pfmea);
    expect(pf.get('PFMEA', 'H11')).toBe('Proc <p@x.com>');
    expect(pf.get('PFMEA', 'C17')).toBe('20 – Machining');
    expect(pf.get('PFMEA', 'E17')).toBe('Ø6.0 +0.1'); // ürün gereksinimi
    expect(pf.get('PFMEA', 'F17')).toBe(null);
    expect(pf.get('PFMEA', 'E18')).toBe(null);
    expect(pf.get('PFMEA', 'F18')).toBe('Spindle 3000 rpm'); // proses parametresine bağlı → proses gereksinimi
    expect(pf.get('PFMEA', 'K18')).toBe(VY);
    expect(pf.get('PFMEA', 'I17')).toBe(8);
    expect(pf.get('PFMEA', 'P17')).toBe('=I17*L17*N17');
    // şablondaki dolu revizyon satırının altına eklenir
    expect(pf.get('Revision History', 'C4')).toBe('Template revision (prefilled row)');
    expect(pf.get('Revision History', 'B5')).toBe('Rev A');
    const pfe = await entries(out.pfmea);
    expect(new TextDecoder().decode(pfe.get('xl/ctrlProps/ctrlProp1.xml')!)).toContain('checked="Checked"'); // Production 72705

    // ---------- Control Plan
    const cp = await ScmhBook.open(out.cp);
    expect(cp.get('Control Plan', 'K5')).toBe('FM-1 Rev B');
    expect(cp.get('Control Plan', 'C19')).toBe('20 – Machining');
    expect(cp.get('Control Plan', 'D19')).toBe('Drill holes');
    expect(cp.get('Control Plan', 'E19')).toBe(VY);
    expect(cp.get('Control Plan', 'F19')).toBe('DRW-1 zone B2');
    expect(cp.get('Control Plan', 'I19')).toBe('KC-001');
    expect(cp.get('Control Plan', 'J19')).toBe('Ø6.0 | +0.1/0');
    expect(cp.get('Control Plan', 'L19')).toBe(VY);
    expect(cp.get('Control Plan', 'G24')).toBe('Char 6');
    expect(String(cp.get('Control Plan', 'B25'))).toMatch(/^©/);
    const cpe = await entries(out.cp);
    expect(new TextDecoder().decode(cpe.get('xl/workbook.xml')!)).toMatch(/'Control Plan'!\$B\$?2:\$O\$?24</); // yazdırma alanı genişledi

    // ---------- PFD
    const pfd = await ScmhBook.open(out.pfd);
    expect(pfd.get('PFD', 'C15')).toBe('10 – Storage'); // op no sırası
    expect(pfd.get('PFD', 'I15')).toBe('▽'); // Storage → Store (standart ad)
    expect(pfd.get('PFD', 'F16')).toBe('○');
    expect(pfd.get('PFD', 'J16')).toBe('☐');
    expect(pfd.get('PFD', 'O16')).toContain('Char 1');
    expect(pfd.get('PFD', 'N16')).toBe('KC-001');
    expect(pfd.get('PFD', 'K17')).toBe('Admin');
    expect(pfd.get('PFD', 'F18')).toBe(VY); // tip yok, ad standart değil
  });

  it('keeps untouched parts byte-identical', async () => {
    const tpl = await templates();
    const out = await buildScmhPackage(project(), tpl);
    for (const kind of ['pfd', 'dfmea', 'pfmea', 'cp'] as ScmhKind[]) {
      const a = await entries(tpl[kind]);
      const b = await entries(out[kind]);
      for (const n of ['xl/externalLinks/externalLink1.xml', 'xl/drawings/drawing99.xml', 'xl/media/image1.bin', 'xl/theme/theme1.xml', 'docProps/core.xml', 'xl/worksheets/sheet3.xml']) {
        expect(b.has(n), `${kind} ${n}`).toBe(true);
        expect(Buffer.from(b.get(n)!).equals(Buffer.from(a.get(n)!)), `${kind} ${n}`).toBe(true);
      }
      const changed = [...a.keys()].filter((n) => b.has(n) && !Buffer.from(a.get(n)!).equals(Buffer.from(b.get(n)!)));
      for (const n of changed) expect(n, kind).toMatch(/^(xl\/worksheets\/sheet[12]\.xml|xl\/styles\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|\[Content_Types\]\.xml|xl\/ctrlProps\/ctrlProp\d+\.xml|xl\/drawings\/vmlDrawing1\.vml)$/);
      // unchecked ctrlProps stay identical
      for (const n of [...a.keys()].filter((x) => x.startsWith('xl/ctrlProps/')))
        if (!new TextDecoder().decode(b.get(n)!).includes('checked=')) expect(Buffer.from(b.get(n)!).equals(Buffer.from(a.get(n)!))).toBe(true);
      // exceljs can still read the output
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(out[kind]);
      expect(wb.getWorksheet(SCMH_LAYOUT[kind].sheet)).toBeTruthy();
      for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => expect(c.text).not.toContain('[object Object]')));
    }
  });

  it('optional trace column writes IDs outside the form', async () => {
    const out = await buildScmhPackage(project(), await templates(), { traceColumn: true });
    const df = await ScmhBook.open(out.dfmea);
    expect(String(df.get('DFMEA', 'AB18'))).toContain('DF-001');
    const plain = await ScmhBook.open((await buildScmhPackage(project(), await templates())).dfmea);
    expect(plain.get('DFMEA', 'AB18')).toBe(null);
  });

  it('file names', () => {
    const p = project();
    expect(SCMH_FILE_NAMES.dfmea).toBe('SCMH-7.2.10_DFMEA');
    expect(scmhFileName('cp', p)).toBe('SCMH-7.2.13_Control-Plan_P-100_RevB.xlsx');
  });
});

describe('SCMH scoring & priority', () => {
  it('tables have ranks 10..1 with df/pf text', () => {
    for (const t of [SCMH_SCORING.severity, SCMH_SCORING.occurrence, SCMH_SCORING.detection]) {
      expect(t.map((e) => e.rank)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      for (const e of t) expect(e.df.length > 10 && e.pf.length > 10).toBe(true);
    }
    expect(SCMH_SCORING.severity[0].df).toMatch(/hazardous failure without warning/);
    expect(SCMH_SCORING.detection[0].pf).toMatch(/No current process control/);
  });

  it('S 9–10 is reviewed regardless of RPN, then RPN, then S×O', () => {
    const rows = [
      { id: 'A', s: 9, o: 1, d: 1 }, // RPN 9 but S=9
      { id: 'B', s: 5, o: 8, d: 10 }, // RPN 400
      { id: 'C', s: 8, o: 5, d: 10 }, // RPN 400, S×O 40
      { id: 'D', s: 4, o: 10, d: 10 }, // RPN 400, S×O 40
      { id: 'E', s: 2, o: 2, d: 2 },
    ];
    expect(scmhPriority(rows[0]).review).toBe(true);
    expect(scmhPriority(rows[1]).review).toBe(false);
    expect(scmhPriority({ s: null, o: 2, d: 2 }).reason).toMatch(/eksik/);
    expect(scmhSort(rows).map((r) => r.id)[0]).toBe('A');
    expect(scmhSort(rows).map((r) => r.id).at(-1)).toBe('E');
    const x = scmhSort([{ id: 'X', s: 6, o: 5, d: 2 }, { id: 'Y', s: 3, o: 2, d: 10 }]); // RPN 60 both, S×O 30 vs 6
    expect(x.map((r) => r.id)).toEqual(['X', 'Y']);
  });

  it('classification options are KC IDs', () => {
    const p = project();
    expect(scmhClassOptions(p)).toEqual(['KC-001']);
  });

  it('scoringStandard: new projects SCMH, older files AIAG-VDA', () => {
    const p = newProject();
    expect(p.settings.scoringStandard).toBe('SCMH');
    expect(p.scoring.severity[0].df).toBe(SCMH_SCORING.severity[0].df);
    const old = JSON.parse(JSON.stringify(p));
    delete old.settings.scoringStandard;
    delete old.scoring;
    const n = normalizeProject(old);
    expect(n.settings.scoringStandard).toBe('AIAG-VDA');
    expect(n.scoring.severity[0].df).toBe(DEFAULT_SCORING.severity[0].df);
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).settings.scoringStandard).toBe('SCMH');
    // new fields get defaults when loading v2 rows
    const v2 = JSON.parse(JSON.stringify(p));
    v2.processSteps = [{ id: 'OP-001', opNo: '10', name: 'Cut' }];
    v2.controlPlan = [{ id: 'CP-001' }];
    const m = normalizeProject(v2);
    expect(m.processSteps[0].stepType).toEqual([]);
    expect(m.processSteps[0].classification).toBe('');
    expect(m.controlPlan[0].reference).toBe('');
    expect(m.meta.organization).toBe('');
  });
});
