import { describe, expect, it } from 'vitest';
import { planEdits } from '../src/shared/engine';
import { blankRow, newProject } from '../src/shared/model';
import { missingReqIssueRows } from '../src/shared/reqIssues';
import type { AnyRow, Project } from '../src/shared/types';

const req = (id: string, d: Record<string, unknown>) => ({ ...blankRow('requirements', id), ...d, id }) as AnyRow;
const addReq = (p: Project, id: string, d: Record<string, unknown>) => planEdits(p, [{ kind: 'add', table: 'requirements', row: req(id, d) }]).project;
const set = (p: Project, id: string, field: string, value: unknown) => planEdits(p, [{ kind: 'set', table: 'requirements', id, field, value }]).project;

describe('VERİ YOK gereksinim → açık konu', () => {
  it('VERİ YOK içeren yeni gereksinim tek bir açık konu açar', () => {
    const p = addReq(newProject(), 'REQ-001', { text: 'Braket 500 N statik yükte deforme olmamalıdır', reqType: 'Performance' });
    const iss = p.issues.filter((i) => i.autoReqId === 'REQ-001');
    expect(iss).toHaveLength(1);
    expect(iss[0]).toMatchObject({ relatedReq: 'REQ-001', status: 'Open', priority: 'Important' });
    expect(iss[0].description).toContain('VERİ YOK');
  });

  it('eksiksiz gereksinim konu açmaz', () => {
    const p = addReq(newProject(), 'REQ-001', { text: 'Kalınlık 3.0 ± 0.1 mm olmalıdır', acceptance: '2.9–3.1 mm', verification: 'Mikrometre', dataStatus: 'Dokümandan (kaynaklı)' });
    expect(p.issues).toHaveLength(0);
  });

  it('bilgi gelince konu kapanır, VERİ YOK geri gelince yeniden açılır', () => {
    let p = addReq(newProject(), 'REQ-001', { text: 'Test', acceptance: 'VERİ YOK – doğrulanmalı', verification: 'Yük testi', dataStatus: 'Dokümandan (kaynaklı)' });
    expect(p.issues[0].status).toBe('Open');
    p = set(p, 'REQ-001', 'acceptance', '≥ 500 N');
    expect(p.issues[0].status).toBe('Resolved');
    expect(p.issues[0].answer).toContain('otomatik');
    p = set(p, 'REQ-001', 'acceptance', 'VERİ YOK – doğrulanmalı');
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0].status).toBe('Open');
  });

  it('reddedilen gereksinimin konusu kapanır; dokunulmamış konu gereksinimle silinir', () => {
    let p = addReq(newProject(), 'REQ-001', { text: 'Test', acceptance: 'VERİ YOK – doğrulanmalı' });
    p = set(p, 'REQ-001', 'approval', 'Rejected');
    expect(p.issues[0].status).toBe('Resolved');
    p = addReq(p, 'REQ-002', { text: 'Test 2', acceptance: 'VERİ YOK – doğrulanmalı' });
    p = planEdits(p, [{ kind: 'delete', table: 'requirements', id: 'REQ-002' }]).project;
    expect(p.issues.some((i) => i.autoReqId === 'REQ-002')).toBe(false);
  });

  it('eski projeler için eksik konular toplu önerilir', () => {
    const p = newProject();
    p.requirements = [req('REQ-001', { text: 'A', acceptance: 'VERİ YOK – doğrulanmalı' }) as Project['requirements'][number], req('REQ-002', { text: 'B', acceptance: '1–2 mm' }) as Project['requirements'][number]];
    const rows = missingReqIssueRows(p);
    expect(rows.map((r) => [r.id, r.autoReqId])).toEqual([['OI-001', 'REQ-001']]);
  });
});
