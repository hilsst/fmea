import { describe, expect, it } from 'vitest';
import { changesSinceApproval, moveRows, moveRowsTo } from '../src/shared/rowOrder';
import { newProject, normalizeProject } from '../src/shared/model';

const rows = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id }) as never);
const ids = (r: { id: string }[] | null) => r?.map((x) => x.id).join('');

describe('satır taşıma', () => {
  it('seçili satırı bir yukarı/aşağı taşır', () => {
    expect(ids(moveRows(rows, ['A', 'B', 'C', 'D', 'E'], ['C'], -1))).toBe('ACBDE');
    expect(ids(moveRows(rows, ['A', 'B', 'C', 'D', 'E'], ['C', 'D'], 1))).toBe('ABECD');
    expect(moveRows(rows, ['A', 'B', 'C', 'D', 'E'], ['A'], -1)).toBeNull();
  });
  it('filtreyle gizli satırlar yerinde kalır', () => {
    expect(ids(moveRows(rows, ['A', 'C', 'E'], ['E'], -1))).toBe('ABEDC');
  });
  it('sürükle-bırak: aşağı hedefin arkasına, yukarı önüne', () => {
    expect(ids(moveRowsTo(rows, ['A', 'B', 'C', 'D', 'E'], ['B'], 'D'))).toBe('ACDBE');
    expect(ids(moveRowsTo(rows, ['A', 'B', 'C', 'D', 'E'], ['D'], 'A'))).toBe('DABCE');
    expect(moveRowsTo(rows, ['A', 'B'], ['B'], 'B')).toBeNull();
  });
});

describe('tablo onayı', () => {
  it('eski dosyalar boş onayla açılır; onay sonrası değişiklik sayılır', () => {
    const p = normalizeProject({ ...newProject(), tableApprovals: undefined } as never);
    expect(p.tableApprovals).toEqual({});
    const a = { user: 'K', at: '2026-10-20T10:00:00.000Z', revision: 'A' };
    p.auditLog = [
      { at: '2026-10-20T09:00:00.000Z', user: 'K', kind: 'Modified', table: 'dfmea', id: 'DF-001', revision: 'A' },
      { at: '2026-10-20T11:00:00.000Z', user: 'K', kind: 'Modified', table: 'dfmea', id: 'DF-001', revision: 'A' },
      { at: '2026-10-20T11:00:00.000Z', user: 'K', kind: 'Modified', table: 'pfmea', id: 'PF-001', revision: 'A' },
    ];
    expect(changesSinceApproval(p, 'dfmea', a)).toBe(1);
    expect(changesSinceApproval(p, 'dfmea', undefined)).toBe(0);
  });
});
