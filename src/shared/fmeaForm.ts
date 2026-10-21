// v4.1: DFMEA / PFMEA ekranlarının F33.03 / F05.04 form başlığı. Değerler proje bilgilerinden (Proje sekmesi) ve tablodan gelir.
import { rpn } from './scoring';
import type { Project } from './types';

export interface FormHeaderField {
  label: string;
  value: string;
}

export interface FormHeader {
  title: string;
  docNo: string;
  fields: FormHeaderField[];
  /** Yalnızca F33.03 / F05.04 düzeninde (formdaki "Largest RPN Value"). */
  largestRpn?: number | null;
}

/** Formdaki “Largest RPN Value” (N kolonunun en büyüğü). */
export function largestRpn(p: Project, kind: 'dfmea' | 'pfmea'): number | null {
  let max: number | null = null;
  for (const r of p[kind]) {
    const v = rpn(r.s, r.o, r.d);
    if (v != null && (max == null || v > max)) max = v;
  }
  return max;
}

export function formHeader(p: Project, kind: 'dfmea' | 'pfmea'): FormHeader {
  const m = p.meta;
  const pre = kind === 'dfmea' ? 'DFMEA' : 'PFMEA';
  if (p.settings.tableFormat !== 'F33')
    return {
      title: kind === 'dfmea' ? 'Design Failure Mode and Effects Analysis' : 'Process Failure Mode and Effects Analysis',
      docNo: kind === 'dfmea' ? 'SCMH 7.2.10' : 'SCMH 7.2.11',
      fields: [
        { label: 'Company/Organization Name', value: m.organization || m.supplier || '' },
        { label: 'Part/Dwg Number(s)', value: m.partNumber },
        { label: 'Part/Dwg Revision(s)', value: m.drawingRevision },
        { label: 'Part/Dwg Name(s)', value: m.partName },
        { label: 'Program/Project', value: m.program },
        { label: kind === 'dfmea' ? 'Product Owner' : 'Process Owner', value: kind === 'dfmea' ? m.productOwner : m.processOwner },
        { label: `${pre} Facilitator`, value: m.facilitator || m.preparedBy || '' },
        { label: 'Cross Functional Team', value: m.team },
        { label: `${pre} Number & Revision`, value: [m.fmeaNumber, m.fmeaRevision].filter(Boolean).join(' Rev ') },
        { label: 'Date (Original)', value: m.startDate },
        { label: 'Date (Revision)', value: m.revisionDate },
      ],
    };
  return {
    title: kind === 'dfmea' ? 'Design Failure Mode and Effects Analysis (DFMEA) Worksheet' : 'Process Failure Mode and Effects Analysis (PFMEA) Worksheet',
    docNo: kind === 'dfmea' ? 'F33.03' : 'F05.04',
    fields: [
      { label: 'Supplier Name', value: m.supplier || m.organization || '' },
      { label: 'Part #', value: m.partNumber },
      { label: 'Part Name', value: m.partName },
      { label: 'Dwg Revision', value: m.drawingRevision },
      { label: `${pre} Team`, value: m.team },
      { label: 'Team Leader', value: m.facilitator || m.preparedBy || '' },
      { label: `${pre} Date (Original)`, value: m.startDate },
      { label: '(Revised)', value: m.revisionDate },
    ],
    largestRpn: largestRpn(p, kind),
  };
}
