import { parseRegion, type TernaryEutecticDiagram } from './diagram';
import type { CompIndex, RegionKey } from './types';

/**
 * 相区命名、配色与物理说明。
 * 同一相区在所有视图（三维、等温截面、垂直截面、投影、冷却曲线）中使用同一颜色。
 * 配色参照 MATLAB 默认线条色序，克制、可区分、适合白色背景。
 */

export const COMPONENT_COLORS = ['#0072BD', '#D95319', '#3C8D2F'];

export const REGION_COLORS: Record<RegionKey, string> = {
  L: '#C9D7E8',
  'L+0': '#0072BD',
  'L+1': '#D95319',
  'L+2': '#3C8D2F',
  'L+0+1': '#7E2F8E',
  'L+1+2': '#C9A227',
  'L+0+2': '#2F9DB5',
  S: '#7F7F7F',
};

/** 二维填色：在白色上叠加的浅色 */
export function regionTint(key: RegionKey, strength = 0.24): string {
  return mixHex(REGION_COLORS[key] ?? '#cccccc', '#ffffff', key === 'L' ? 0.35 : 1 - strength);
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const c = pa.map((v, n) => Math.round(v + (pb[n] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function regionName(key: RegionKey, sym: string[]): string {
  if (key === 'L') return 'L';
  if (key === 'S') return `${sym[0]}+${sym[1]}+${sym[2]}`;
  const { solids } = parseRegion(key);
  return ['L', ...solids.map((i) => sym[i])].join('+');
}

export function regionDof(key: RegionKey): number {
  if (key === 'L') return 3;
  if (key === 'S') return 1;
  return 4 - (parseRegion(key).solids.length + 1);
}

export function regionDescription(key: RegionKey, sym: string[]): string {
  if (key === 'L') return '均匀液相区。单相平衡，恒压下 F = 3 − 1 + 1 = 3：温度与两个独立成分可同时自由变化。';
  if (key === 'S')
    return `三固相区 ${sym[0]}+${sym[1]}+${sym[2]}。位于三元共晶平面以下，固相互不溶，各相成分即纯组元，相对量由成分点在三角形中的重心坐标给出；F = 1，仅温度可变。`;
  const { solids } = parseRegion(key);
  if (solids.length === 1) {
    const s = sym[solids[0]];
    return `两相区 L+${s}。液相与初晶 ${s} 平衡，连结线由 ${s} 顶点出发；液相成分落在 ${s} 初晶面上，相对量由杠杆规则确定。F = 2。`;
  }
  const [i, j] = solids;
  return `三相区 L+${sym[i]}+${sym[j]}。在任一温度的截面为连结三角形 (${sym[i]}, ${sym[j]}, m(T))，顶点 m(T) 位于单变线上；该区的上、下界面为直纹面。F = 1：给定温度则三相成分全部确定。`;
}

export function phaseLabel(p: 'L' | CompIndex, sym: string[]): string {
  return p === 'L' ? '液相 L' : `固相 ${sym[p]}`;
}

export function phaseColor(p: 'L' | CompIndex): string {
  return p === 'L' ? '#5A7FA8' : COMPONENT_COLORS[p];
}

export function formatC(T: number, digits = 1): string {
  return `${(T - 273.15).toFixed(digits)} °C`;
}

export function compText(x: number[], sym: string[], digits = 3): string {
  return x.map((v, n) => `x(${sym[n]})=${v.toFixed(digits)}`).join('  ');
}

/** 可选中对象的说明 */
export interface ObjectInfo {
  title: string;
  kind: string;
  rows: [string, string][];
  explanation: string;
}

export function describeObject(id: string, d: TernaryEutecticDiagram): ObjectInfo | null {
  const sym = d.params.components.map((c) => c.symbol);
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  const compRows = (x: number[]): [string, string][] => x.map((v, n) => [`x(${sym[n]})`, pct(v)]);
  if (id.startsWith('field:')) {
    const i = Number(id.slice(6)) as CompIndex;
    return {
      title: `${sym[i]} 初晶面（液相面）`,
      kind: '曲面',
      rows: [
        ['方程', `T = (ΔH + Gᵉˣ) / (ΔH/T_m − R ln x_${sym[i]})`],
        ['T_m', formatC(d.params.components[i].Tm)],
        ['ΔH_fus', `${(d.params.components[i].dH / 1000).toFixed(1)} kJ/mol`],
      ],
      explanation: `该曲面上的液相与纯固相 ${sym[i]} 平衡。成分点自上方冷却至此面时开始析出初晶 ${sym[i]}。曲面在 ${sym[i]} 顶点取最高值 T_m，向两条单变线方向降低，边界为共晶谷线。`,
    };
  }
  if (id.startsWith('mono:')) {
    const key = id.slice(5);
    const line = d.mono[key];
    const b = d.binary[key];
    return {
      title: `单变线 E_${sym[line.i]}${sym[line.j]} → E`,
      kind: '空间曲线',
      rows: [
        ['起点', `E_${sym[line.i]}${sym[line.j]} ${formatC(b.T)}`],
        ['终点', `E ${formatC(d.eutectic.T)}`],
        ['反应', `L → ${sym[line.i]} + ${sym[line.j]}`],
      ],
      explanation: `${sym[line.i]}、${sym[line.j]} 两初晶面的交线（共晶谷线）。沿此线液相同时与 ${sym[line.i]}、${sym[line.j]} 平衡，三相共存 F = 1，温度自二元共晶点单调降至三元共晶点。`,
    };
  }
  if (id.startsWith('ruled:')) {
    const [, pk, e] = id.split(':');
    const line = d.mono[pk];
    const end = Number(e) as CompIndex;
    const other = end === line.i ? line.j : line.i;
    return {
      title: `直纹面 L+${sym[end]} / L+${sym[line.i]}+${sym[line.j]}`,
      kind: '直纹面',
      rows: [
        ['母线', `${sym[end]} 顶点 — m(T)`],
        ['温度范围', `${formatC(d.eutectic.T)} ~ ${formatC(d.binary[pk].T)}`],
      ],
      explanation: `由连结线 e_${sym[end]}—m(T) 随温度扫掠而成（m(T) 沿单变线移动）。其上方为两相区 L+${sym[end]}，下方为三相区；成分点穿过此面时开始共析出 ${sym[other]}（二元共晶反应）。`,
    };
  }
  if (id === 'eplane') {
    return {
      title: '三元共晶平面',
      kind: '水平面',
      rows: [
        ['温度', formatC(d.eutectic.T)],
        ...compRows(d.eutectic.comp),
      ],
      explanation: `四相平衡 L(E) ⇌ ${sym[0]} + ${sym[1]} + ${sym[2]} 的不变平面，也是本体系的固相面。F = 0：温度与四相成分均固定，反应恒温进行直至液相耗尽。`,
    };
  }
  if (id.startsWith('pt:')) {
    const p = d.specialPoints.find((s) => s.id === id);
    if (!p) return null;
    if (p.kind === 'melting') {
      const i = p.members[0];
      return {
        title: `纯组元 ${sym[i]} 熔点`,
        kind: '不变点（单元系）',
        rows: [['温度', formatC(p.T)]],
        explanation: `单元系固–液平衡，F = 1 − 2 + 1 = 0。${sym[i]} 初晶面的最高点。`,
      };
    }
    if (p.kind === 'binaryEutectic') {
      const [i, j] = p.members;
      return {
        title: `二元共晶点 E_${sym[i]}${sym[j]}`,
        kind: '不变点（二元系）',
        rows: [['温度', formatC(p.T)], ...compRows(p.comp)],
        explanation: `二元 ${sym[i]}–${sym[j]} 系的共晶反应 L ⇌ ${sym[i]} + ${sym[j]}。在三元系中它是单变线的高温端点，加入第三组元使共晶温度沿单变线降低。`,
      };
    }
    return {
      title: '三元共晶点 E',
      kind: '不变点（三元系）',
      rows: [['温度', formatC(p.T)], ...compRows(p.comp)],
      explanation: `三个初晶面与三条单变线的交汇点，液相面最低点。L ⇌ ${sym[0]} + ${sym[1]} + ${sym[2]}，F = 0。成分恰为 E 的合金在此温度一次性凝固为全三元共晶组织。`,
    };
  }
  if (id.startsWith('region:')) {
    const key = id.slice(7);
    return {
      title: `相区 ${regionName(key, sym)}`,
      kind: '空间相区',
      rows: [['自由度 F', String(regionDof(key))]],
      explanation: regionDescription(key, sym),
    };
  }
  return null;
}
