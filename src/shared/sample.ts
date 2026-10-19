// Eğitim amaçlı örnek proje (FMEA-CP-001 sandviç kompozit panel test parçası).
// Değerler projedeki TS-FMEA-CP-001 Rev A şartnamesi ve DRW-001 resminden alınmıştır; S/O/D değerleri AI önerisidir.
import { planEdits, type Edit } from './engine';
import { blankRow, newProject } from './model';
import type { AnyRow, Project, TableKey } from './types';

function row<T extends AnyRow>(table: TableKey, id: string, data: Partial<T>): T {
  return { ...blankRow(table, id), ...data, id } as T;
}

export function sampleProject(): Project {
  const p = newProject();
  p.meta = {
    ...p.meta,
    name: 'Sandviç Kompozit Panel – Eğitim',
    partNumber: 'FMEA-CP-001',
    partName: 'Sandviç kompozit panel (test parçası)',
    customer: 'VERİ YOK – doğrulanmalı',
    program: 'Eğitim / test',
    drawingRevision: 'Rev A',
    fmeaNumber: 'FMEA-CP-001',
    fmeaRevision: 'Rev A',
    scope: 'Panel tasarımı (DFMEA) ve üretimi (PFMEA): kesim, lay-up, vakum torbalama, kür, CNC delme, insert bonding, final muayene.',
  };
  const edits: Edit[] = [];
  const add = (table: TableKey, r: AnyRow) => edits.push({ kind: 'add', table, row: r });

  add('documents', row('documents', 'DOC-001', { name: 'FMEA Test Teknik Şartname', docType: 'Teknik şartname', docNumber: 'TS-FMEA-CP-001', revision: 'A', date: '2026-10-13' }));
  add('documents', row('documents', 'DOC-002', { name: 'FMEA Test Teknik Resim', docType: 'Teknik resim', docNumber: 'DRW-001', revision: 'A' }));

  add('requirements', row('requirements', 'REQ-001', { text: 'Toplam panel kalınlığı 25.6–26.4 mm', reqType: 'Dimensional', acceptance: '25.6–26.4 mm', verification: 'Ölçüm', source: 'TS-FMEA-CP-001 §5', dataStatus: 'Dokümandan (kaynaklı)', approval: 'AI Proposed' }));
  add('requirements', row('requirements', 'REQ-002', { text: '4X Ø6.0 +0.10/0 delik', reqType: 'Dimensional', acceptance: 'Ø6.00–6.10 mm', verification: 'Tapa mastar / CMM', source: 'DRW-001 / Ölçü Ø6.0', dataStatus: 'Dokümandan (kaynaklı)', approval: 'AI Proposed' }));
  add('requirements', row('requirements', 'REQ-003', { text: 'Bondline kalınlığı 0.20–0.40 mm', reqType: 'Manufacturing', acceptance: '0.20–0.40 mm', verification: 'VERİ YOK – doğrulanmalı', source: 'DRW-001 Not / TS §6', dataStatus: 'Dokümandan (kaynaklı)', approval: 'AI Proposed' }));
  add('requirements', row('requirements', 'REQ-004', { text: 'Kür: 120 °C / 2.0 bar g / ≥120 dk', reqType: 'Manufacturing', acceptance: '120 °C, 2.0 bar g, ≥120 dk', verification: 'Kür kaydı', source: 'TS-FMEA-CP-001 §7', dataStatus: 'Dokümandan (kaynaklı)', approval: 'AI Proposed' }));
  add('requirements', row('requirements', 'REQ-005', { text: 'Çalışma sıcaklığı -40 / +80 °C', reqType: 'Environmental', acceptance: 'VERİ YOK – doğrulanmalı', verification: 'VERİ YOK – doğrulanmalı', source: 'TS-FMEA-CP-001 §4', dataStatus: 'VERİ YOK – doğrulanmalı', approval: 'AI Proposed' }));

  add('structure', row('structure', 'FN-001', { level: 'Product', element: 'Sandviç panel', function: 'Yükü taşır ve montaj arayüzü sağlar', functionType: 'Taşıma', reqIds: ['REQ-001', 'REQ-005'] }));
  add('structure', row('structure', 'FN-002', { level: 'Feature', parentId: 'FN-001', element: 'Montaj delikleri (4X)', function: 'Cıvata geçişi ve konumlandırma sağlar', functionType: 'Bağlantı', reqIds: ['REQ-002'] }));
  add('structure', row('structure', 'FN-003', { level: 'Feature', parentId: 'FN-001', element: 'Insert bonding yüzeyi', function: 'Insert yükünü panele aktarır', functionType: 'Yük aktarma', reqIds: ['REQ-003'] }));

  add('dfmea', row('dfmea', 'DF-001', { functionId: 'FN-002', reqIds: ['REQ-002'], failureMode: 'Delik çapı küçük – cıvata geçmiyor', effect: 'Montaj yapılamaz', cause: 'Tolerans zinciri tanımlı değil', prevention: 'Tolerans analizi', detection: 'İlk parça CMM', s: 7, o: 4, d: 4, source: 'REQ-002', confidence: 'Medium', approval: 'AI Proposed', dataStatus: 'AI VARSAYIMI – mühendislik doğrulaması gerekli' }));
  add('dfmea', row('dfmea', 'DF-002', { functionId: 'FN-003', reqIds: ['REQ-003'], failureMode: 'Insert bağlantısı yük altında ayrılıyor', effect: 'Bağlantı kaybı – fonksiyon kaybı', cause: 'Bondline kabul kriteri ve test yöntemi tanımlı değil', prevention: '', detection: 'VERİ YOK – doğrulanmalı', s: 9, o: 5, d: 7, source: 'REQ-003, TS §9 eksik', confidence: 'Low', approval: 'AI Proposed', dataStatus: 'AI VARSAYIMI – mühendislik doğrulaması gerekli' }));

  add('processSteps', row('processSteps', 'OP-001', { opNo: '10', name: 'Lay-up', description: '[0/90]s yüz kaplaması serimi' }));
  add('processSteps', row('processSteps', 'OP-002', { opNo: '20', name: 'Cure', description: 'Otoklav kürü 120 °C / 2.0 bar g', specialProcess: true, machine: 'Otoklav-1' }));
  add('processSteps', row('processSteps', 'OP-003', { opNo: '30', name: 'Machining', description: '4X Ø6 delik CNC delme', machine: 'CNC-1' }));
  add('processSteps', row('processSteps', 'OP-004', { opNo: '40', name: 'Bonding', description: 'M6 insert bonding (EA-9394)', specialProcess: true }));

  add('pfmea', row('pfmea', 'PF-001', { stepId: 'OP-003', dfIds: ['DF-001'], processFunction: 'Delik delme', requirement: 'Ø6.00–6.10', failureMode: 'Hole undersize', effect: 'Montaj yapılamaz', cause: 'Takım aşınması; takım ömrü tanımlı değil', prevention: 'Takım ömrü sayacı (AI RECOMMENDATION)', detection: 'Go/no-go tapa mastar', o: 4, d: 4, measurement: 'Tapa mastar', reactionPlan: 'Parça karantina + NCR, takım değişimi', source: 'DF-001', approval: 'AI Proposed' }));
  add('pfmea', row('pfmea', 'PF-002', { stepId: 'OP-004', dfIds: ['DF-002'], processFunction: 'Insert yapıştırma', requirement: 'Bondline 0.20–0.40 mm', failureMode: 'Incorrect adhesive thickness', effect: 'Insert ayrılması', cause: 'Fikstür yok; operatör kalınlığı gözle ayarlıyor', prevention: '', detection: 'Görsel kontrol', o: 6, d: 7, errorProofing: 'Fixture', source: 'DF-002', approval: 'AI Proposed' }));

  add('issues', row('issues', 'OI-001', { description: 'Bondline kabul kriteri ve test yöntemi şartnamede yok (TS §9).', priority: 'Critical', source: 'TS-FMEA-CP-001 §9', relatedReq: 'REQ-003', relatedFmea: 'DF-002', status: 'Open' }));
  add('issues', row('issues', 'OI-002', { description: 'Yüz kaplaması toleransı “0.50 ±0.08 (tek taraflı ±)” çelişkili.', priority: 'Important', source: 'TS-FMEA-CP-001 §5', status: 'Open' }));

  const plan = planEdits(p, edits);
  const out = plan.project;
  out.changeLog = [];
  return out;
}
