import { create } from 'zustand';
import { computeTrace, sampleIndexAtT, type Trace } from '../core/cooling';
import { PhaseDiagram } from '../core/diagram';
import { defaultSection, resolveSection, sectionThroughState, type SectionConfig } from '../core/sections';
import { getPreset, PRESETS, type Preset } from '../core/presets';
import type { Comp, Equilibrium, SystemParams } from '../core/types';

export type Tab = 'iso' | 'vert' | 'proj' | 'info';

export interface Layers {
  liquidus: boolean;
  opacity: number;
  isotherms: boolean;
  boundaries: boolean;
  arrows: boolean;
  invariants: boolean;
  planes: boolean;
  compounds: boolean;
  binaryFaces: boolean;
  fieldLabels: boolean;
  grid: boolean;
  tieTriangle: boolean;
  path: boolean;
  cutaway: boolean;
  /** 液相面着色：温度（parula）或初晶相 */
  surfaceColor: 'temperature' | 'field';
  /** 温度轴纵向拉伸 */
  tScale: number;
}

export type Selection =
  | { kind: 'invariant'; id: string }
  | { kind: 'curve'; id: string; s?: number }
  | { kind: 'field'; si: number }
  | { kind: 'compound'; si: number }
  | { kind: 'region'; key: string };

export interface ParamOverride {
  /** 化合物稳定度：−ΔHf / (J·mol⁻¹)，null 表示使用预设 */
  stab: number | null;
  /** 液相相互作用参数（三个二元项统一） / (J·mol⁻¹) */
  omega: number;
  /** 组元熔点偏移 / K（A、B、C） */
  dTm: [number, number, number];
}

export const defaultOverride = (): ParamOverride => ({ stab: null, omega: 0, dTm: [0, 0, 0] });

export const defaultLayers = (): Layers => ({
  liquidus: true,
  opacity: 1,
  isotherms: true,
  boundaries: true,
  arrows: true,
  invariants: true,
  planes: true,
  compounds: true,
  binaryFaces: true,
  fieldLabels: true,
  grid: true,
  tieTriangle: true,
  path: true,
  cutaway: true,
  tScale: 1,
  surfaceColor: 'temperature',
});

export function buildParams(preset: Preset, ov: ParamOverride): SystemParams {
  const p = structuredClone(preset.params);
  if (ov.stab !== null && preset.tunable >= 0) p.compounds[preset.tunable].dHf = -ov.stab;
  p.omega = { AB: ov.omega, AC: ov.omega, BC: ov.omega };
  for (let i = 0; i < 3; i++) p.components[i].Tm += ov.dTm[i];
  return p;
}

function normalize(x: Comp): Comp {
  const a = Math.max(0, x[0]);
  const b = Math.max(0, x[1]);
  const c = Math.max(0, x[2]);
  const s = a + b + c || 1;
  return [a / s, b / s, c / s];
}

function defaultT(d: PhaseDiagram, x: Comp): number {
  const Tl = d.liquidus(x).T;
  let lo = Infinity;
  for (const iv of d.topo.invariants) if (iv.rank === 'ternary') lo = Math.min(lo, iv.T);
  if (!isFinite(lo)) lo = Tl - 150;
  return Math.max(lo + 8, Tl - Math.min(110, (Tl - lo) * 0.45));
}

export interface AppState {
  presetId: string;
  override: ParamOverride;
  diagram: PhaseDiagram;
  x0: Comp;
  T: number;
  /** 不变反应平台内的进度（-1 表示不在平台内） */
  xi: number;
  eq: Equilibrium;
  trace: Trace;
  idx: number;
  playing: boolean;
  speed: number;
  isoOn: boolean;
  vertOn: boolean;
  section: SectionConfig;
  layers: Layers;
  selection: Selection | null;
  tab: Tab;
  focus3d: boolean;
  dockOpen: boolean;
  tourNote: string;
  /** 三维相机位姿（跨页面保持） */
  camera: CameraPose | null;
  /**
   * 交互模式（全局）：
   *   composition  成分探索 —— 用户改变总成分 x₀（温度为参数）；
   *   cooling      冷却凝固 —— 总成分 x₀ 固定，只有温度变化；液相成分、相分数随之演化。
   * 冷却模式下任何改变 x₀ 的操作都会被拒绝并给出提示，防止把总成分误当作沿凝固轨迹移动的点。
   */
  mode: InteractionMode;
  view2d: View2D;
  overlays: Overlays;
  /** 一次性提示（例如冷却模式下试图拖动 x₀） */
  notice: { text: string; at: number } | null;

  loadPreset: (id: string) => void;
  setOverride: (p: Partial<ParamOverride>) => void;
  /** force：示例载入、URL 恢复等程序性设置，不受冷却模式限制 */
  setX0: (x: Comp, keepT?: boolean, force?: boolean) => void;
  setComp: (i: 0 | 1 | 2, v: number) => void;
  setT: (T: number) => void;
  setIdx: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setSection: (p: Partial<SectionConfig>) => void;
  setLayers: (p: Partial<Layers>) => void;
  setSel: (s: Selection | null) => void;
  setTab: (t: Tab) => void;
  setFocus: (b: boolean) => void;
  setDockOpen: (b: boolean) => void;
  setIsoOn: (b: boolean) => void;
  setVertOn: (b: boolean) => void;
  setTour: (s: string) => void;
  setCamera: (c: CameraPose | null) => void;
  setMode: (m: InteractionMode) => void;
  setView2d: (v: View2D) => void;
  setOverlays: (p: Partial<Overlays>) => void;
  flash: (text: string) => void;
  /** 一次性应用（URL 深链接等）的物理状态 */
  hydrate: (p: { presetId?: string; override?: ParamOverride; x0?: Comp; T?: number }) => void;
}

export type InteractionMode = 'composition' | 'cooling';

/** 工作台二维图：视图与叠加层（跨页面保持） */
export type View2D = 'iso' | 'proj' | 'vert';
export interface Overlays {
  /** 成分读数线（过 x₀ 平行于各边的辅助投影线） */
  read: boolean;
  /** 成分向量分解 */
  vec: boolean;
  /** 平衡相点、连结线 / 连结三角形、杠杆臂 */
  eq: boolean;
  /** 液相面梯度与等温线切向 */
  grad: boolean;
  /** 界线切向 / 法向 */
  frame: boolean;
  /** 液相成分轨迹 */
  path: boolean;
  /** x₀ 的移动轨迹与位移向量 */
  trail: boolean;
  /** 恒温下相邻相区的方向探测 */
  nbr: boolean;
}
export const defaultOverlays = (): Overlays => ({ read: true, vec: false, eq: true, grad: true, frame: true, path: true, trail: true, nbr: false });

export interface CameraPose {
  pos: [number, number, number];
  target: [number, number, number];
}

function init(presetId: string, ov: ParamOverride) {
  const preset = getPreset(presetId);
  const diagram = new PhaseDiagram(buildParams(preset, ov));
  const x0 = preset.x0;
  const T = defaultT(diagram, x0);
  const trace = computeTrace(diagram, x0);
  const idx = sampleIndexAtT(trace, T);
  return { diagram, x0, T, trace, idx, eq: diagram.equilibrium(x0, T) };
}

const first = init(PRESETS[0].id, defaultOverride());

function initialSection(presetId: string, d: PhaseDiagram): SectionConfig {
  const sec = defaultSection();
  if (d.ns > 3) {
    sec.mode = 'join';
    sec.join = presetId.startsWith('ternary') ? [3, 0] : [3, 2];
  }
  return sec;
}

function stateEq(s: { diagram: PhaseDiagram; x0: Comp; T: number; xi: number; trace: Trace; idx: number }): Equilibrium {
  if (s.xi >= 0) {
    const sm = s.trace.samples[Math.min(s.trace.samples.length - 1, Math.max(0, Math.round(s.idx)))];
    if (sm && sm.xi >= 0) return sm.eq;
  }
  return s.diagram.equilibrium(s.x0, s.T);
}

export const useStore = create<AppState>((set, get) => ({
  presetId: PRESETS[0].id,
  override: defaultOverride(),
  ...first,
  xi: -1,
  playing: false,
  speed: 1,
  isoOn: true,
  vertOn: true,
  section: initialSection(PRESETS[0].id, first.diagram),
  layers: defaultLayers(),
  selection: null,
  tab: 'iso',
  focus3d: false,
  dockOpen: true,
  tourNote: '',
  camera: null,
  mode: 'composition',
  view2d: 'iso',
  overlays: defaultOverlays(),
  notice: null,

  loadPreset: (id) => {
    const ov = defaultOverride();
    const st = init(id, ov);
    const preset = getPreset(id);
    const sec = initialSection(preset.id, st.diagram);
    set({ presetId: id, override: ov, ...st, xi: -1, playing: false, section: sec, selection: null, tourNote: '' });
  },

  setOverride: (p) => {
    const s = get();
    const ov = { ...s.override, ...p };
    const preset = getPreset(s.presetId);
    const diagram = new PhaseDiagram(buildParams(preset, ov));
    const trace = computeTrace(diagram, s.x0);
    const range = diagram.tRange();
    const T = Math.min(range.Tmax, Math.max(range.Tmin, s.T));
    const idx = sampleIndexAtT(trace, T);
    const sec = { ...s.section };
    if (sec.mode === 'join' && (sec.join[0] >= diagram.ns || sec.join[1] >= diagram.ns)) sec.mode = 'parallel';
    set({ override: ov, diagram, trace, T, idx, xi: -1, section: sec, eq: diagram.equilibrium(s.x0, T), selection: null });
  },

  setX0: (x, keepT, force) => {
    const s = get();
    if (s.mode === 'cooling' && !force) {
      s.flash('冷却凝固模式：总成分 x₀ 固定不变（封闭体系）。如需改变成分，请切换到"成分探索"模式。');
      return;
    }
    const x0 = normalize(x);
    const trace = computeTrace(s.diagram, x0);
    const T = keepT === false ? defaultT(s.diagram, x0) : s.T;
    const idx = sampleIndexAtT(trace, T);
    set({ x0, trace, T, idx, xi: -1, eq: s.diagram.equilibrium(x0, T) });
  },

  setComp: (i, v) => {
    const s = get();
    const x = [...s.x0] as Comp;
    const val = Math.min(1, Math.max(0, v));
    const rest = 1 - x[i];
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    if (rest < 1e-9) {
      x[j] = (1 - val) / 2;
      x[k] = (1 - val) / 2;
    } else {
      const f = (1 - val) / rest;
      x[j] *= f;
      x[k] *= f;
    }
    x[i] = val;
    get().setX0(x);
  },

  setT: (T) => {
    const s = get();
    const range = s.diagram.tRange();
    const t = Math.min(range.Tmax, Math.max(range.Tmin, T));
    const idx = sampleIndexAtT(s.trace, t);
    set({ T: t, idx, xi: -1, eq: s.diagram.equilibrium(s.x0, t) });
  },

  setIdx: (i) => {
    const s = get();
    if (s.mode !== 'cooling') get().setMode('cooling');
    const n = s.trace.samples.length;
    const idx = Math.min(n - 1, Math.max(0, i));
    const sm = s.trace.samples[Math.round(idx)];
    const next = { idx, T: sm.T, xi: sm.xi };
    set({ ...next, eq: stateEq({ ...s, ...next }) });
  },

  // 播放冷却过程即"固定 x₀、改变 T"：自动进入冷却凝固模式
  setPlaying: (playing) => {
    if (playing && get().mode !== 'cooling') {
      get().setMode('cooling');
      set({ playing });
    } else set({ playing });
  },
  setSpeed: (speed) => set({ speed }),
  setSection: (p) => set({ section: { ...get().section, ...p } }),
  setLayers: (p) => set({ layers: { ...get().layers, ...p } }),
  setSel: (selection) => set({ selection }),
  setTab: (tab) => set({ tab }),
  setFocus: (focus3d) => set({ focus3d }),
  setDockOpen: (dockOpen) => set({ dockOpen }),
  setIsoOn: (isoOn) => set({ isoOn }),
  setVertOn: (vertOn) => set({ vertOn }),
  setTour: (tourNote) => set({ tourNote }),
  setCamera: (camera) => set({ camera }),
  setMode: (mode) => {
    const s = get();
    if (mode === s.mode) return;
    // 进入冷却模式：时间轴对齐到当前温度；回到成分探索：退出平台、停止播放
    if (mode === 'cooling') {
      // 冷却模式下 x₀ 固定，垂直截面必须经过状态点；否则自动切到"过状态点"（沿用原方向）
      const through = sectionThroughState(s.section, s.diagram, s.x0);
      set({ mode, idx: sampleIndexAtT(s.trace, s.T), playing: false, ...(through ? { section: through } : {}) });
      if (through) get().flash('冷却模式：垂直截面已切换为"过状态点"（沿用原方向），使状态点位于截面上。');
    }
    else set({ mode, playing: false, xi: -1, eq: s.diagram.equilibrium(s.x0, s.T) });
  },
  flash: (text) => set({ notice: { text, at: Date.now() } }),
  setView2d: (view2d) => set({ view2d }),
  setOverlays: (p) => set({ overlays: { ...get().overlays, ...p } }),

  hydrate: (p) => {
    const s = get();
    const presetId = p.presetId ?? s.presetId;
    const ov = p.override ?? (p.presetId && p.presetId !== s.presetId ? defaultOverride() : s.override);
    const preset = getPreset(presetId);
    const diagram = presetId === s.presetId && ov === s.override ? s.diagram : new PhaseDiagram(buildParams(preset, ov));
    const x0 = p.x0 ? normalize(p.x0) : presetId !== s.presetId ? preset.x0 : s.x0;
    const range = diagram.tRange();
    const T0 = p.T ?? (presetId !== s.presetId ? defaultT(diagram, x0) : s.T);
    const T = Math.min(range.Tmax, Math.max(range.Tmin, T0));
    const trace = x0 === s.x0 && diagram === s.diagram ? s.trace : computeTrace(diagram, x0);
    const section = presetId !== s.presetId ? initialSection(presetId, diagram) : s.section;
    set({ presetId, override: ov, diagram, x0, T, trace, idx: sampleIndexAtT(trace, T), xi: -1, eq: diagram.equilibrium(x0, T), section, selection: presetId !== s.presetId ? null : s.selection });
  },
}));

/** 当前截面规格（解析后） */
export function currentSpec(s: AppState) {
  return resolveSection(s.section, s.diagram, s.x0);
}
