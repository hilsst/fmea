// v4-kc: yerel, tek seferlik kontrol (vitest ÇALIŞTIRMAZ): gerçek IAQG 7.2.16 KC Traceability Form şablonunu
// örnek KC'lerle doldurur. Şablon © IAQG olduğundan depoda değildir; yol argümanla verilir.
//   node tests/kc.local.mjs <7.2.16 şablon .xlsx> [çıktı .xlsx]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = process.argv[2];
const out = process.argv[3] || join(tmpdir(), 'kc-form-out.xlsx');
if (!tpl) throw new Error('Kullanım: node tests/kc.local.mjs <şablon.xlsx> [çıktı.xlsx]');
const entry = join(tmpdir(), `kc-local-entry-${process.pid}.ts`);
writeFileSync(entry, `export { buildKcForm } from ${JSON.stringify(join(root, 'src/shared/kcForm.ts'))};
export { newProject, blankRow } from ${JSON.stringify(join(root, 'src/shared/model.ts'))};`);
const bundle = join(tmpdir(), `kc-local-${process.pid}.mjs`);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error', nodePaths: [join(root, 'node_modules')] });
const m = await import(pathToFileURL(bundle).href);
rmSync(entry, { force: true });
rmSync(bundle, { force: true });

const p = m.newProject();
Object.assign(p.meta, { partNumber: 'P-100', partName: 'Bracket', drawingRevision: 'B', kcFormRevision: '1', kcFormDate: '2026-10-20', kcContacts: 'Design Eng, Mfg Eng' });
p.kcs = Array.from({ length: 7 }, (_, i) => ({
  ...m.blankRow('kcs', `KC-00${i + 1}`), kcNo: `P-100-KC-00${i + 1}`, characteristic: `Characteristic ${i + 1}`, specification: '0.100 ± 0.010',
  designRecordRef: `Sheet 1 Zone A-${i + 1}`, impact: ['Assembly', 'Durability'], severity: 8, sourceId: 'DF-001', status: 'Approved',
  lifecycle: i === 3 ? 'Eliminated' : 'Confirmed', eliminatedBy: i === 3 ? 'Design change' : '', eliminationNote: i === 3 ? 'Design change removed the risk' : '',
}));
writeFileSync(out, await m.buildKcForm(p, new Uint8Array(readFileSync(tpl))));
console.log(`yazıldı: ${out}`);
