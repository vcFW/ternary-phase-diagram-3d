/**
 * 设计令牌：全站语义色的唯一来源。业务代码禁止出现十六进制颜色字面量（见 P1.3）。
 * 配色取 MATLAB 默认色序，浅色背景。CSS 通过 cssVariables() 在启动时注入同名变量。
 */

/** MATLAB 默认色序（折线图多序列默认取色顺序） */
export const SERIES = ['#0072BD', '#D95319', '#EDB120', '#7E2F8E', '#77AC30', '#4DBEEE', '#A2142F'] as const;

export const COLOR = {
  /** 通用强调色（选中、滑块、链接）；不代表任何组元 */
  accent: '#0072BD',
  ink: '#1d2229',
  muted: '#7b8490',
  /** 当前状态点 x₀ / 当前时刻 */
  stateX0: '#c00000',
  phase: {
    /** 液相：线、点、色块、曲线（深灰，避开所有组元色） */
    liquid: '#4d4d4d',
    /** 液相：相区填充底色（浅蓝灰） */
    liquidFill: '#a9c8e4',
  },
  /** 组元 A、B、C */
  component: ['#D95319', '#0072BD', '#77AC30'],
  /** 化合物（按下标循环） */
  compound: ['#EDB120', '#7E2F8E', '#4DBEEE', '#A2142F'],
  /** 界线（按反应类型）：共晶线 / 过渡型转熔线 / 包晶型转熔线 */
  line: {
    eutectic: '#1d2229',
    transition: '#D95319',
    peritectic: '#c00000',
  },
  /** 平衡冷却的结晶路径 */
  path: '#7E2F8E',
  /** 不变点：共晶 E / 过渡点 U / 包晶 P。与组元色不重复使用同一含义 */
  point: {
    eutectic: '#1a1a1a',
    transition: '#00796B',
    peritectic: '#A2142F',
  },
} as const;

/** 固相按下标取色：组元 A、B、C，然后化合物 */
export const SOLID_COLORS: string[] = [...COLOR.component, ...COLOR.compound];

/** '#rrggbb' → 0xrrggbb（three.js 用） */
export function hexNum(c: string): number {
  return parseInt(c.slice(1), 16);
}

/** 注入 CSS 变量，使样式表可以写 var(--accent) 而不重复十六进制字面量 */
export function applyCssVariables(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--accent': COLOR.accent,
    '--c-liquid': COLOR.phase.liquid,
    '--c-liquid-fill': COLOR.phase.liquidFill,
    '--c-state': COLOR.stateX0,
    '--c-comp-a': COLOR.component[0],
    '--c-comp-b': COLOR.component[1],
    '--c-comp-c': COLOR.component[2],
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
