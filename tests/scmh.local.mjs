// Yerel, tek seferlik kontrol (vitest ÇALIŞTIRMAZ): gerçek IAQG SCMH şablonlarını sampleProject() ile doldurur.
// Şablonlar © IAQG olduğundan depoda değildir; yol argümanla veya SCMH_TEMPLATES ile verilir.
//   node tests/scmh.local.mjs [şablon klasörü] [çıktı klasörü]
// Varsayılan: /mnt/project-files/fmea/scmh/templates → /tmp/claude-0/scmh-out
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tdir = process.argv[2] || process.env.SCMH_TEMPLATES || '/mnt/project-files/fmea/scmh/templates';
const out = process.argv[3] || '/tmp/claude-0/scmh-out';
mkdirSync(out, { recursive: true });

const entry = join(tmpdir(), `scmh-local-entry-${process.pid}.ts`);
writeFileSync(
  entry,
  `export { buildScmhPackage, scmhFileName, SCMH_TEMPLATE_FILES } from ${JSON.stringify(join(root, 'src/shared/scmh.ts'))};
   export { sampleProject } from ${JSON.stringify(join(root, 'src/shared/sample.ts'))};
   export { normalizeProject, blankRow } from ${JSON.stringify(join(root, 'src/shared/model.ts'))};`,
);
const bundle = join(tmpdir(), `scmh-local-${process.pid}.mjs`);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error', nodePaths: [join(root, 'node_modules')] });
const m = await import(pathToFileURL(bundle).href);
rmSync(entry, { force: true });
rmSync(bundle, { force: true });

const files = readdirSync(tdir);
const pick = (kind) => {
  const want = m.SCMH_TEMPLATE_FILES[kind];
  const f = files.find((x) => x === want) ?? files.find((x) => x.includes(want.split('-Template')[0]));
  if (!f) throw new Error(`Şablon bulunamadı: ${want} (${tdir})`);
  return new Uint8Array(readFileSync(join(tdir, f)));
};
const templates = { pfd: pick('pfd'), dfmea: pick('dfmea'), pfmea: pick('pfmea'), cp: pick('cp') };

const p = m.sampleProject();
// SCMH başlık/aşama alanları (örnek)
p.meta.dfmeaLevel = 'Component';
p.meta.scmhPhase = 'Pre-Production';
// Satır ekleme yolunu gerçek şablonda da sına: Kontrol Planı'nda 27 şablon satırından fazlası
for (let i = 0; i < 30; i++)
  p.controlPlan.push({ ...m.blankRow('controlPlan', 'x'), id: `CP-${String(100 + i).padStart(3, '0')}`, stepId: 'OP-003', productChar: `Delik çapı #${i + 1}`, specification: 'Ø6.00–6.10', method: 'Tapa mastar', frequency: '%100', reactionPlan: 'Karantina + NCR' });
// DFMEA'da 59 şablon satırından fazlası (formül/paylaşılan formül genişletme yolu)
const df0 = p.dfmea[0];
for (let i = 0; i < 63; i++) p.dfmea.push({ ...structuredClone(df0), id: `DF-${String(100 + i).padStart(3, '0')}`, actionId: '', s: 1 + (i % 10), o: 1 + ((i * 3) % 10), d: 1 + ((i * 7) % 10) });
const res = await m.buildScmhPackage(p, templates);
for (const kind of ['pfd', 'dfmea', 'pfmea', 'cp']) {
  const path = join(out, m.scmhFileName(kind, p));
  writeFileSync(path, res[kind]);
  console.log(kind, path, res[kind].length);
}
