/**
 * 设计令牌：全站语义色的唯一来源。业务代码禁止出现十六进制颜色字面量（见 P1.3）。
 * 配色取 MATLAB 默认色序，浅色背景。CSS 变量由 tokensCss() 生成到 src/styles/tokens.css
 * （npm run gen:tokens；tests/style.test.ts 校验二者同步）。
 */

/** MATLAB 默认色序（折线图多序列默认取色顺序） */
export const SERIES = ['#0072BD', '#D95319', '#EDB120', '#7E2F8E', '#77AC30', '#4DBEEE', '#A2142F'] as const;

export const COLOR = {
  /** 通用强调色（选中、滑块、链接）；不代表任何组元 */
  accent: '#0072BD',
  ink: '#1d2229',
  muted: '#7b8490',
  dim: '#4b5563',
  faint: '#9aa3ad',
  white: '#ffffff',
  black: '#111111',
  ok: '#2e6b1f',
  accent2: '#1f4e79',
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

/** 三维场景专用灰阶 / 辅助色 */
export const SCENE = {
  ambient: '#ffffff',
  edge: '#202020',
  background: '#eef0f3',
  wall: '#dfe2e6',
  frameLine: '#9da3ab',
  grid: '#c3c8cf',
  hypothetical: '#555555',
  black: '#000000',
  tieEdge: '#b8860b',
  black2: '#111111',
} as const;

/** 固相按下标取色：组元 A、B、C，然后化合物 */
export const SOLID_COLORS: string[] = [...COLOR.component, ...COLOR.compound];

/** '#rrggbb' → 0xrrggbb（three.js 用） */
export function hexNum(c: string): number {
  return parseInt(c.slice(1), 16);
}

/** 字号阶梯（px）：全站只用这五级 */
export const FONT_SIZE = { xs: 11, sm: 12, md: 13, lg: 15, xl: 18 } as const;
/** 间距阶梯（px） */
export const SPACE = [4, 8, 12, 16, 24] as const;
/** 线宽（px）：坐标轴 / 相界 / 强调 */
export const LINE_WIDTH = { axis: 1, boundary: 1.5, strong: 2 } as const;

/** 样式表中使用的语义色（CSS 变量名 → 值） */
const SEMANTIC: Record<string, string> = {
  white: COLOR.white,
  bg: '#e9e9e9',
  panel: COLOR.white,
  panel2: '#f7f8fa',
  line: '#d0d3d8',
  line2: '#b4b8bf',
  text: COLOR.ink,
  dim: '#4b5563',
  dim2: COLOR.muted,
  accent: COLOR.accent,
  accent2: '#1f4e79',
  warn: COLOR.component[0],
  danger: COLOR.stateX0,
  'mfig-border': '#b4b4b4',
  'mfig-title': '#f0f0f0',
  'tstrip-bg': '#f5f5f5',
  'tbtn-hover': '#e5f1fb',
  'tbtn-on': '#cce4f7',
  'tbtn-on-border': '#7eb4ea',
  'c-liquid': COLOR.phase.liquid,
  'c-liquid-fill': COLOR.phase.liquidFill,
  'c-state': COLOR.stateX0,
  'c-path': COLOR.path,
  'c-comp-a': COLOR.component[0],
  'c-comp-b': COLOR.component[1],
  'c-comp-c': COLOR.component[2],
  'c-comp-3': COLOR.compound[0],
  'c-comp-6': COLOR.compound[3],
};

/** 其余样式用色：按色相类 + 明度（L%）命名的色阶 */
const PALETTE: Record<string, string> = {
  'blue-19': '#24303c',
  'blue-24': '#2f3c49',
  'blue-35': '#4a5866',
  'blue-68': '#7fb3dc',
  'blue-69': '#9fb0c0',
  'blue-75': '#9cc2e2',
  'blue-82': '#b7d4ea',
  'blue-83': '#c9d4de',
  'blue-84': '#cfd4db',
  'blue-86': '#c4ddf3',
  'blue-90': '#e3e6ea',
  'blue-92': '#e6ebf0',
  'blue-94': '#e8f1f9',
  'blue-94-2': '#eceff2',
  'blue-94-3': '#eef0f3',
  'blue-95': '#eef1f4',
  'blue-96': '#eef5fb',
  'blue-96-2': '#f2f4f7',
  'blue-97': '#f3f8fc',
  'blue-98': '#f9fafb',
  'blue-98-2': '#fafbfc',
  'gray-27': '#444444',
  'gray-42': '#6b6b6b',
  'gray-78': '#c8c8c8',
  'gray-81': '#cfcfcf',
  'gray-84': '#d6d6d6',
  'gray-88': '#e0e0e0',
  'gray-91': '#e6e8eb',
  'gray-97': '#f7f7f7',
  'gray-98': '#fafafa',
  'green-27': '#2e6b1f',
  'green-71': '#a9d19a',
  'green-95': '#f1f8ee',
  'orange-31': '#8a3a12',
  'orange-34': '#6b5f40',
  'orange-63': '#c9b27a',
  'orange-92': '#fff3d6',
  'orange-97': '#fdf5f1',
  'purple-29': '#5b2a6b',
  'purple-76': '#cfa9db',
  'purple-96': '#f8f0fb',
  'red-33': '#8a1d1d',
  'red-77': '#e3a6a6',
  'red-81': '#efc2ae',
  'red-95': '#fdf0ea',
  'red-96': '#fcf0f0',
  'yellow-18': '#5c4a00',
  'yellow-25': '#6b5a12',
  'yellow-27': '#8a6d00',
  'yellow-70': '#dccb8a',
  'yellow-94': '#fff8e1',
  'yellow-94-2': '#ffffe1',
  'yellow-95': '#fbf7e8',
  'yellow-96': '#fffbea',
};

/** 全部 CSS 变量（不含 --）。 */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = { ...SEMANTIC, ...PALETTE };
  out['radius'] = '2px';
  out['font'] = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif";
  out['mono'] = "'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace";
  out['axes-font'] = "'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  for (const [k, v] of Object.entries(FONT_SIZE)) out[`fs-${k}`] = `${v}px`;
  SPACE.forEach((v, i) => (out[`sp-${i + 1}`] = `${v}px`));
  for (const [k, v] of Object.entries(LINE_WIDTH)) out[`lw-${k}`] = `${v}px`;
  return out;
}

/** src/styles/tokens.css 的全文 */
export function tokensCss(): string {
  const body = Object.entries(cssVariables())
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');
  return `/* 由 src/ui/tokens.ts 生成，勿手改（npm run gen:tokens） */\n:root {\n${body}\n}\n`;
}
