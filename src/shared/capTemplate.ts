// v4-cap: şirket şablonunda capability kabul bandı, alt grup minimumu ve MSA kriteri doğrulaması.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

export function capTemplateErrors(s: Record<string, unknown>): string[] {
  const e: string[] = [];
  if ('capAcceptance' in s) {
    const a = s.capAcceptance;
    if (!isObj(a) || typeof a.accept !== 'number' || typeof a.conditional !== 'number' || !(a.accept > 0) || !(a.conditional > 0) || a.conditional > a.accept)
      e.push('settings.capAcceptance: { accept, conditional, source } olmalı ve conditional ≤ accept');
    else if (a.source != null && typeof a.source !== 'string') e.push('settings.capAcceptance.source: metin olmalı');
  }
  if ('minSubgroups' in s && s.minSubgroups !== null && !(Number.isInteger(s.minSubgroups) && (s.minSubgroups as number) >= 2))
    e.push('settings.minSubgroups: ≥2 tam sayı veya boş olmalı');
  if ('msaCriteria' in s) {
    const m = s.msaCriteria;
    if (!isObj(m)) e.push('settings.msaCriteria: nesne olmalı');
    else {
      for (const k of ['maxGrrPct', 'minNdc', 'minKappa']) if (k in m && !numOrNull(m[k])) e.push(`settings.msaCriteria.${k}: sayı veya boş olmalı`);
      for (const k of ['resolutionRatio', 'tur']) if (k in m && !(typeof m[k] === 'number' && (m[k] as number) > 0)) e.push(`settings.msaCriteria.${k}: pozitif sayı olmalı`);
      if ('basis' in m && m.basis !== '%Tolerance' && m.basis !== '%Study Var') e.push('settings.msaCriteria.basis: %Tolerance veya %Study Var olmalı');
    }
  }
  return e;
}
