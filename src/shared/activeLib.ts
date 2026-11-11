// 4.12.0: Çalışma zamanında geçerli birleşik kütüphane (yerleşik − devre dışı + firma).
// Saf fonksiyonlar `lib` parametresi almazsa buraya bakar; hiçbir şey ayarlanmamışsa YERLEŞİK kütüphane kullanılır.
// Yalnız tür içe aktarılır (döngüsel bağımlılık olmaz).
import type { MergedLib } from './companyLib';

let active: MergedLib | undefined;

export const setActiveLib = (lib?: MergedLib) => {
  active = lib;
};
export const getActiveLib = (): MergedLib | undefined => active;
