import type { PhaseDiagram } from './diagram';

import { COLOR, SOLID_COLORS } from '../ui/tokens';

export { SOLID_COLORS };
/** 液相：线 / 点 / 色块用深灰；相区填充底色用浅蓝灰（令牌见 ui/tokens.ts） */
export const LIQUID_COLOR = COLOR.phase.liquid;
export const LIQUID_FILL = COLOR.phase.liquidFill;

export type RGB = [number, number, number];

export function hexToRgb(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbCss(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function solidColor(si: number): string {
  return SOLID_COLORS[si % SOLID_COLORS.length];
}

export function phaseColor(d: PhaseDiagram, id: string): string {
  if (id === 'L') return LIQUID_COLOR;
  const s = d.solids.find((q) => q.id === id);
  return s ? solidColor(s.index) : COLOR.muted;
}

/** 相区填充色：固相色平均并提亮为浅色；含液相者向浅蓝灰的液相色混合，以区分"含液相"与"全固态"。 */
export function regionRgb(d: PhaseDiagram, key: string, dark = false): RGB {
  void dark;
  const ids = key.split('+');
  const solids = ids.filter((i) => i !== 'L').map((i) => hexToRgb(phaseColor(d, i)));
  const hasL = ids.includes('L');
  const L = hexToRgb(LIQUID_FILL);
  const W: RGB = [255, 255, 255];
  if (!solids.length) return mixRgb(L, W, 0.62);
  let avg: RGB = [0, 0, 0];
  for (const s of solids) avg = [avg[0] + s[0] / solids.length, avg[1] + s[1] / solids.length, avg[2] + s[2] / solids.length];
  if (hasL) {
    const w = solids.length === 1 ? 0.5 : solids.length === 2 ? 0.6 : 0.68;
    return mixRgb(mixRgb(L, avg, w), W, 0.34);
  }
  return mixRgb(avg, W, 0.5);
}

export function regionCss(d: PhaseDiagram, key: string, a = 1, dark = false): string {
  return rgbCss(regionRgb(d, key, dark), a);
}

/** 相区中文名 */
export function regionName(key: string): string {
  const ids = key.split('+');
  const nL = ids.includes('L') ? 1 : 0;
  const n = ids.length;
  const solids = ids.filter((i) => i !== 'L');
  if (key === 'L') return '单相区：液相 L';
  if (nL && n === 2) return `两相区：液相 L + 固相 ${solids[0]}`;
  if (nL && n === 3) return `三相区：液相 L + ${solids.join(' + ')}`;
  if (nL && n === 4) return `四相不变反应平台：L + ${solids.join(' + ')}（F = 0）`;
  if (n === 1) return `单相区：固相 ${solids[0]}`;
  if (n === 2) return `两相区：${solids.join(' + ')}（固态）`;
  return `三固相区：${solids.join(' + ')}`;
}

export const cel = (K: number, digits = 0) => `${(K - 273.15).toFixed(digits)} °C`;
export const toC = (K: number) => K - 273.15;
export const toK = (C: number) => C + 273.15;
