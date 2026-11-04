import { create } from 'zustand';
import { call, Channel, useWorkerFor } from '../compute/client';
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
  /** 含固溶体的体系在 Worker 中构建期间为 true；此时界面仍显示旧图 */
  /** 成分探索中 x₀ 的移动历史（含当时的 G 与相分数），供“演化”面板与 x₀ 轨迹叠加层使用 */
  history: { x: Comp; G: number; f: Record<string, number> }[];
  computing: boolean;
  /** 正在构建的目标体系（顶栏选择器显示用） */
  pendingPreset: string | null;
  /** 异步计算结果到达计数：依赖异步缓存的视图订阅它来重绘 */
  asyncTick: number;
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
/** 叠加层预设：基本（默认，只显示平衡相点 / 连结线与液相轨迹）→ 几何（再加读数线、成分向量、∇T、界线标架）→ 全部 */
export const OVERLAY_PRESETS: Record<'basic' | 'geometry' | 'all', { label: string; title: string; set: Overlays }> = {
  basic: { label: '基本', title: '平衡相点 + 连结线 + 液相轨迹（默认）', set: { read: false, vec: false, eq: true, grad: false, frame: false, path: true, trail: false, nbr: false } },
  geometry: { label: '几何', title: '再加读数线、成分向量、∇T、界线标架', set: { read: true, vec: true, eq: true, grad: true, frame: true, path: true, trail: false, nbr: false } },
  all: { label: '全部', title: '全部叠加层', set: { read: true, vec: true, eq: true, grad: true, frame: true, path: true, trail: true, nbr: true } },
};
export const defaultOverlays = (): Overlays => ({ ...OVERLAY_PRESETS.basic.set });

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

const sameComp = (a: Comp, b: Comp) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-12;
let buildSeq = 0;
const traceChannel = new Channel();

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

export const useStore = create<AppState>((set, get) => {
  /**
   * 构建相图（及给定成分的冷却轨迹）。化学计量体系同步完成；含固溶体的体系在 Worker 中提取拓扑，
   * 期间 computing = true、旧图保持显示，完成后 done 在主线程用已提取的拓扑构造相图实例。
   */
  const withDiagram = (params: SystemParams, x0: Comp, pending: string | null, done: (d: PhaseDiagram, trace: Trace) => void) => {
    const seq = ++buildSeq;
    if (!useWorkerFor(params)) {
      const d = new PhaseDiagram(params);
      done(d, computeTrace(d, x0));
      return;
    }
    set({ computing: true, pendingPreset: pending });
    call(params, 'build', x0)
      .then(({ topo, liqGrid, trace }) => {
        if (seq !== buildSeq) return;
        done(new PhaseDiagram(params, 150, { topo, liqGrid }), trace);
      })
      .catch((e) => {
        console.error('相图构建失败', e);
        if (seq === buildSeq) set({ computing: false, pendingPreset: null });
      });
  };

  /** 成分改变后更新冷却轨迹：化学计量体系同步；固溶体体系异步（期间沿用同一相图上的旧轨迹） */
  const refreshTrace = (d: PhaseDiagram, x0: Comp): Trace | null => {
    if (!useWorkerFor(d.params)) return computeTrace(d, x0);
    traceChannel.submit('trace', async () => {
      const tr = await call(d.params, 'trace', x0);
      const s = get();
      if (s.diagram !== d || !sameComp(s.x0, x0)) return;
      set({ trace: tr, idx: sampleIndexAtT(tr, s.T), asyncTick: s.asyncTick + 1 });
    });
    return null;
  };

  return {
  history: [],
  computing: false,
  pendingPreset: null,
  asyncTick: 0,
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
  tourNote: '',
  camera: null,
  mode: 'composition',
  view2d: 'iso',
  overlays: defaultOverlays(),
  notice: null,

  loadPreset: (id) => {
    const ov = defaultOverride();
    const preset = getPreset(id);
    const x0 = preset.x0;
    withDiagram(buildParams(preset, ov), x0, id, (diagram, trace) => {
      const T = defaultT(diagram, x0);
      const sec = initialSection(preset.id, diagram);
      set({
        presetId: id, override: ov, diagram, x0, T, trace, idx: sampleIndexAtT(trace, T), eq: diagram.equilibrium(x0, T),
        xi: -1, playing: false, section: sec, selection: null, tourNote: '', computing: false, pendingPreset: null,
      });
    });
  },

  setOverride: (p) => {
    const s = get();
    const ov = { ...s.override, ...p };
    const preset = getPreset(s.presetId);
    withDiagram(buildParams(preset, ov), s.x0, null, (diagram, trace) => {
      const cur = get();
      const range = diagram.tRange();
      const T = Math.min(range.Tmax, Math.max(range.Tmin, cur.T));
      const idx = sampleIndexAtT(trace, T);
      const sec = { ...cur.section };
      if (sec.mode === 'join' && (sec.join[0] >= diagram.ns || sec.join[1] >= diagram.ns)) sec.mode = 'parallel';
      set({ override: ov, diagram, trace, T, idx, xi: -1, section: sec, eq: diagram.equilibrium(cur.x0, T), selection: null, computing: false, pendingPreset: null });
      if (!sameComp(trace.x0, cur.x0)) {
        const tr = refreshTrace(diagram, cur.x0);
        if (tr) set({ trace: tr, idx: sampleIndexAtT(tr, T) });
      }
    });
  },

  setX0: (x, keepT, force) => {
    const s = get();
    if (s.mode === 'cooling' && !force) {
      s.flash('冷却凝固模式：总成分 x₀ 固定不变（封闭体系）。如需改变成分，请切换到"成分探索"模式。');
      return;
    }
    const x0 = normalize(x);
    const T = keepT === false ? defaultT(s.diagram, x0) : s.T;
    const trace = refreshTrace(s.diagram, x0);
    if (trace) set({ x0, trace, T, idx: sampleIndexAtT(trace, T), xi: -1, eq: s.diagram.equilibrium(x0, T) });
    else set({ x0, T, xi: -1, eq: s.diagram.equilibrium(x0, T) });
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
    const x0 = p.x0 ? normalize(p.x0) : presetId !== s.presetId ? preset.x0 : s.x0;
    const finish = (diagram: PhaseDiagram, trace0: Trace | null) => {
      const cur = get();
      const range = diagram.tRange();
      const T0 = p.T ?? (presetId !== cur.presetId ? defaultT(diagram, x0) : cur.T);
      const T = Math.min(range.Tmax, Math.max(range.Tmin, T0));
      const trace = trace0 ?? cur.trace;
      const section = presetId !== cur.presetId ? initialSection(presetId, diagram) : cur.section;
      set({
        presetId, override: ov, diagram, x0, T, trace, idx: sampleIndexAtT(trace, T), xi: -1, eq: diagram.equilibrium(x0, T), section,
        selection: presetId !== cur.presetId ? null : cur.selection, computing: false, pendingPreset: null,
      });
    };
    if (presetId === s.presetId && ov === s.override) {
      const trace = x0 === s.x0 ? s.trace : refreshTrace(s.diagram, x0);
      finish(s.diagram, trace);
    } else withDiagram(buildParams(preset, ov), x0, presetId, (diagram, trace) => finish(diagram, trace));
  },
  };
});

/** 当前截面规格（解析后） */
export function currentSpec(s: AppState) {
  return resolveSection(s.section, s.diagram, s.x0);
}

// 成分探索：记录 x₀ 的移动历史（换体系时清空）
useStore.subscribe((s, p) => {
  if (s.diagram.uid !== p.diagram.uid) {
    if (s.history.length) useStore.setState({ history: [] });
    return;
  }
  if (s.mode !== 'composition' || (s.x0 === p.x0 && s.eq === p.eq)) return;
  const prev = s.history[s.history.length - 1];
  if (prev && Math.hypot(prev.x[0] - s.x0[0], prev.x[1] - s.x0[1], prev.x[2] - s.x0[2]) < 0.004) return;
  const f: Record<string, number> = {};
  for (const ph of s.eq.phases) f[ph.id] = ph.frac;
  useStore.setState({ history: [...s.history.slice(-79), { x: s.x0, G: s.eq.G, f }] });
});
