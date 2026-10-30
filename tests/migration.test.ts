import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeProject, SCHEMA_VERSION, type MigrationReport } from '../src/shared/model';

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

/** Eski dosyadaki her değer yeni projede aynı yolda bulunmalı. */
function expectSuperset(oldV: unknown, newV: unknown, path = ''): void {
  if (Array.isArray(oldV)) {
    expect(Array.isArray(newV), path).toBe(true);
    expect((newV as unknown[]).length, path).toBe(oldV.length);
    oldV.forEach((v, i) => expectSuperset(v, (newV as unknown[])[i], `${path}[${i}]`));
  } else if (oldV && typeof oldV === 'object') {
    for (const [k, v] of Object.entries(oldV)) {
      if (path === '' && k === 'schemaVersion') continue;
      expectSuperset(v, (newV as Record<string, unknown>)[k], `${path}.${k}`);
    }
  } else expect(newV, path).toEqual(oldV);
}

describe('v1 → v2 migration', () => {
  it('opens the 1.0 sample project without data loss', () => {
    const raw = load('v1-sample.fmea');
    expect(raw.schemaVersion).toBe(1);
    const rep = {} as MigrationReport;
    const p = normalizeProject(structuredClone(raw), rep);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(rep.from).toBe(1);
    expect(rep.notes.length).toBeGreaterThan(0);
    // 4.4.0: boş RPN eşiği bilinçli olarak 100'e taşınır (notla bildirilir); diğer her şey korunur.
    expect(p.settings.rpnThreshold).toBe(100);
    expect(rep.notes.some((n) => n.includes('RPN aksiyon eşiği 100'))).toBe(true);
    expectSuperset({ ...raw, settings: { ...raw.settings, rpnThreshold: 100 } }, p);
    expect(p.evidence).toEqual([]);
    expect(p.baselines).toEqual([]);
    expect(p.auditLog).toEqual([]);
    expect(p.docIndex).toEqual({});
    expect(p.dfmea[0].sReason).toBe('');
    expect(p.pfmea[0].why1).toBe('');
    expect(p.settings.aiMode).toBe('strict');
    expect(p.settings.kcSeverityThreshold).toBe(raw.settings.kcSeverityThreshold);
  });

  it('opens a minimal versionless file', () => {
    const raw = load('v1-minimal.fmea');
    const p = normalizeProject(structuredClone(raw));
    expectSuperset(raw, p);
    expect(p.dfmea[0].reqIds).toEqual(['REQ-001']);
    expect(p.requirements[0].nominal).toBeNull();
    expect(p.history.length).toBe(1);
    expect(p.processParams).toEqual([]);
  });

  it('is idempotent for v2 files', () => {
    const p1 = normalizeProject(load('v1-sample.fmea'));
    const p2 = normalizeProject(JSON.parse(JSON.stringify(p1)));
    expect(p2).toEqual(p1);
  });
});
