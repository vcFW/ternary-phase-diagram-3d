import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { SQRT3_2, toXY } from '../core/barycentric';
import { drawIso, drawVertical, THEME_LIGHT, triLayout } from '../core/canvasDraw';
import { colormap } from '../core/colormap';
import { cel, hexToRgb, phaseColor, regionRgb, SOLID_COLORS, solidColor, toC } from '../core/colors';
import { LIQ_GRID_N, type PhaseDiagram } from '../core/diagram';
import { nearestOnPerimeter, perimeterLine, resolveSection, type SectionConfig } from '../core/sections';
import type { Trace } from '../core/cooling';
import type { Comp, Equilibrium } from '../core/types';
import { lerpComp, type VerticalSpec } from '../core/vertical';
import type { Layers, Selection } from '../state/store';
import { COLOR, hexNum, SCENE } from '../ui/tokens';
import { useWorkerFor } from '../compute/client';
import { isoOf, regionSlicesOf, verticalOf } from '../state/asyncCompute';
import type { IsoSection } from '../core/isothermal';
import type { VerticalRaster } from '../core/vertical';

/** 世界坐标：成分三角形位于 XZ 平面（A 左前、B 右前、C 后），温度映射到 Y。 */
const HEIGHT0 = 1.12;
const H0 = SQRT3_2 / 3;

export interface SceneState {
  diagram: PhaseDiagram;
  x0: Comp;
  T: number;
  eq: Equilibrium;
  trace: Trace;
  idx: number;
  isoOn: boolean;
  vertOn: boolean;
  section: SectionConfig;
  layers: Layers;
  selection: Selection | null;
}

export interface HoverInfo {
  text: string;
  sub?: string;
  x: number;
  y: number;
}

export interface SceneCallbacks {
  onSetT: (T: number) => void;
  onSetX0: (x: Comp) => void;
  onSection: (p: Partial<SectionConfig>) => void;
  onSelect: (s: Selection | null) => void;
  onHover: (h: HoverInfo | null) => void;
}

const V3 = THREE.Vector3;
const PARULA: [number, number, number][] = Array.from({ length: 10 }, (_, i) => colormap('parula', i / 9));

function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
    else if (mat) {
      const t = (mat as THREE.MeshBasicMaterial).map;
      if (t) t.dispose();
      mat.dispose();
    }
  });
}

const LIQ_VERT = /* glsl */ `
attribute vec4 tA;
attribute vec4 tB;
varying vec4 vA;
varying vec4 vB;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vA = tA; vB = tB;
  vN = normalize(normalMatrix * normal);
  vY = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const LIQ_FRAG = /* glsl */ `
uniform vec3 uColors[8];
uniform vec3 uParula[10];
uniform float uOpacity;
uniform float uCut;
uniform float uCutY;
uniform float uIso;
uniform float uIsoStep;
uniform float uMode;
uniform float uTmin;
uniform float uTmax;
varying vec4 vA;
varying vec4 vB;
varying vec3 vN;
varying vec3 vV;
varying float vY;
vec3 parula(float t) {
  float u = clamp(t, 0.0, 1.0) * 9.0;
  int i = int(min(floor(u), 8.0));
  float f = u - float(i);
  vec3 a = uParula[0]; vec3 b = uParula[1];
  for (int k = 0; k < 9; k++) { if (k == i) { a = uParula[k]; b = uParula[k + 1]; } }
  return mix(a, b, f);
}
void main() {
  if (uCut > 0.5 && vY > uCutY) discard;
  float t[8];
  t[0]=vA.x; t[1]=vA.y; t[2]=vA.z; t[3]=vA.w; t[4]=vB.x; t[5]=vB.y; t[6]=vB.z; t[7]=vB.w;
  float best = -1.0; float second = -1.0; int bi = 0;
  for (int i = 0; i < 8; i++) {
    if (t[i] > best) { second = best; best = t[i]; bi = i; }
    else if (t[i] > second) { second = t[i]; }
  }
  vec3 base = uColors[0];
  for (int i = 0; i < 8; i++) if (i == bi) base = uColors[i];
  if (uMode > 0.5) base = parula((best - uTmin) / (uTmax - uTmin));
  else base = mix(base, vec3(1.0), 0.42);
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(0.35, 0.85, 0.45));
  float diff = max(dot(n, L), 0.0);
  vec3 col = base * (0.72 + 0.34 * diff);
  // 等温线：黑色细线
  if (uIso > 0.5) {
    float s = (best - 273.15) / uIsoStep;
    float w = fwidth(s);
    float f = abs(fract(s - 0.5) - 0.5) / max(w, 1e-5);
    float line = 1.0 - smoothstep(0.0, 1.1, f);
    col = mix(col, vec3(0.0), line * 0.34);
  }
  // 初晶区边界：黑色细线
  float gap = (best - second) / max(fwidth(best - second), 1e-5);
  float edge = 1.0 - smoothstep(0.6, 1.5, gap);
  col = mix(col, vec3(0.05), edge * 0.9);
  gl_FragColor = vec4(col, uOpacity);
}`;

interface Handle {
  mesh: THREE.Mesh;
  kind: 'p1' | 'p2' | 'T' | 'state';
}

export class PhaseScene {
  private el: HTMLElement;
  private cb: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private css: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private H = HEIGHT0;
  private tScale = 1;
  private userMoved = false;
  private dirty = true;
  private ro: ResizeObserver;

  private staticGroup = new THREE.Group();
  private dyn = new THREE.Group();
  private labelsStatic: CSS2DObject[] = [];
  private d: PhaseDiagram | null = null;
  private range = { Tmin: 300, Tmax: 1500 };
  private st: SceneState | null = null;
  private liqMat: THREE.ShaderMaterial | null = null;
  private liqMesh: THREE.Mesh | null = null;
  private fieldLabels: CSS2DObject[] = [];
  private detailLabels: { si: number; l: CSS2DObject }[] = [];
  private groups: Record<string, THREE.Object3D> = {};

  // 动态对象
  private isoMesh: THREE.Mesh | null = null;
  private isoTex: THREE.CanvasTexture | null = null;
  private isoCanvas = document.createElement('canvas');
  private isoSec: IsoSection | null = null;
  private vMesh: THREE.Mesh | null = null;
  private vTex: THREE.CanvasTexture | null = null;
  private vCanvas = document.createElement('canvas');
  private vKey = '';
  private vRas: VerticalRaster | null = null;
  private vTimer = 0;
  private handles: Handle[] = [];
  private tLabel: CSS2DObject | null = null;
  private stateGroup = new THREE.Group();
  private pathGroup = new THREE.Group();
  private regionGroup = new THREE.Group();
  private regionKey = '';
  private invPickers: THREE.Mesh[] = [];
  private cutPlane = new THREE.Plane(new V3(0, -1, 0), 0);

  // 交互
  private ray = new THREE.Raycaster();
  private drag: null | {
    kind: 'T' | 'state' | 'p1' | 'p2' | 'vbody' | 'ibody';
    startPx: [number, number];
    moved: boolean;
    startY: number;
    startT: number;
    startHit: THREE.Vector3;
    startSpec: VerticalSpec;
    hit: THREE.Vector3;
  } = null;
  private spec: VerticalSpec = { p1: [1, 0, 0], p2: [0, 1, 0] };

  constructor(el: HTMLElement, cb: SceneCallbacks) {
    this.el = el;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.style.display = 'block';
    el.appendChild(this.renderer.domElement);
    this.css = new CSS2DRenderer();
    this.css.domElement.style.position = 'absolute';
    this.css.domElement.style.inset = '0';
    this.css.domElement.style.pointerEvents = 'none';
    el.appendChild(this.css.domElement);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
    this.camera.position.set(1.42, 1.18, 1.72);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.42, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => (this.userMoved = true));
    this.scene.add(this.staticGroup, this.dyn);
    this.dyn.add(this.stateGroup, this.pathGroup, this.regionGroup);
    const amb = new THREE.AmbientLight(hexNum(SCENE.ambient), 1);
    this.scene.add(amb);
    this.initIso();
    this.initVert();
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onDown, true);
    dom.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointerleave', () => this.cb.onHover(null));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.controls.update()) this.dirty = true;
      if (this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
        this.css.render(this.scene, this.camera);
      }
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('pointerup', this.onUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown, true);
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css.domElement.remove();
  }

  private resize() {
    const w = this.el.clientWidth || 300;
    const h = this.el.clientHeight || 300;
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.fitCamera(new V3(1.42, 1.18, 1.72));
    this.dirty = true;
  }

  /** 按视口宽高比自动取景：保证整个三棱柱完整可见 */
  private fitCamera(dir: THREE.Vector3, target = new V3(0, this.H * 0.45, 0)) {
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = Math.max(1.62 * this.H / (2 * Math.tan(vf / 2)) + 0.5, 1.55 / (2 * Math.tan(hf / 2)));
    this.camera.position.copy(target).addScaledVector(dir.clone().normalize(), dist);
    this.controls.target.copy(target);
    this.controls.update();
  }

  requestRender() {
    this.dirty = true;
  }

  /** 相机位姿（用于跨页面保持视角） */
  getCamera(): { pos: [number, number, number]; target: [number, number, number] } | null {
    if (!this.userMoved) return null;
    const p = this.camera.position;
    const t = this.controls.target;
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setCamera(c: { pos: [number, number, number]; target: [number, number, number] }) {
    this.userMoved = true;
    this.camera.position.set(...c.pos);
    this.controls.target.set(...c.target);
    this.controls.update();
    this.dirty = true;
  }

  /** 导出 PNG（数据 URL） */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ------------------------------------------------------------ 坐标
  private W(x: Comp, T: number): THREE.Vector3 {
    const [u, v] = toXY(x);
    return new V3(u - 0.5, ((T - this.range.Tmin) / (this.range.Tmax - this.range.Tmin)) * this.H, H0 - v);
  }
  private yOf(T: number) {
    return ((T - this.range.Tmin) / (this.range.Tmax - this.range.Tmin)) * this.H;
  }
  private TofY(y: number) {
    return this.range.Tmin + (y / this.H) * (this.range.Tmax - this.range.Tmin);
  }
  private compOfXZ(X: number, Z: number): Comp {
    const u = X + 0.5;
    const v = H0 - Z;
    const c = v / SQRT3_2;
    const b = u - 0.5 * c;
    return [1 - b - c, b, c];
  }
  private clampComp(x: Comp): Comp {
    const a = Math.max(0, x[0]);
    const b = Math.max(0, x[1]);
    const c = Math.max(0, x[2]);
    const s = a + b + c || 1;
    return [a / s, b / s, c / s];
  }

  // ------------------------------------------------------------ 辅助构件
  private mkLabel(text: string, cls = ''): CSS2DObject {
    const div = document.createElement('div');
    div.className = `l3d ${cls}`;
    div.innerHTML = text;
    return new CSS2DObject(div);
  }

  private mkLine(points: THREE.Vector3[], color: number | number[], width: number, opts?: { dashed?: boolean; opacity?: number; clip?: boolean }): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    if (Array.isArray(color)) {
      const cols: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const c = new THREE.Color(color[Math.min(i, color.length - 1)]);
        cols.push(c.r, c.g, c.b);
      }
      geo.setColors(cols);
    }
    const mat = new LineMaterial({
      color: Array.isArray(color) ? hexNum(SCENE.ambient) : color,
      linewidth: width,
      vertexColors: Array.isArray(color),
      dashed: !!opts?.dashed,
      dashSize: 0.02,
      gapSize: 0.014,
      transparent: opts?.opacity !== undefined && opts.opacity < 1,
      opacity: opts?.opacity ?? 1,
      worldUnits: false,
    });
    mat.resolution.set(this.el.clientWidth || 300, this.el.clientHeight || 300);
    if (opts?.clip) mat.clippingPlanes = [this.cutPlane];
    const l = new Line2(geo, mat);
    l.onBeforeRender = () => mat.resolution.set(this.el.clientWidth || 300, this.el.clientHeight || 300);
    if (opts?.dashed) l.computeLineDistances();
    return l;
  }

  private mkLineSeg(points: THREE.Vector3[], color: number, opacity = 1): THREE.LineSegments {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  }

  // ------------------------------------------------------------ 静态几何
  setDiagram(d: PhaseDiagram) {
    this.d = d;
    this.range = d.tRange();
    // 清理
    disposeObject(this.staticGroup);
    this.staticGroup.clear();
    this.labelsStatic.forEach((l) => l.removeFromParent());
    this.labelsStatic = [];
    this.detailLabels = [];
    this.groups = {};
    this.invPickers = [];
    const G = (name: string) => {
      const g = new THREE.Group();
      g.name = name;
      this.groups[name] = g;
      this.staticGroup.add(g);
      return g;
    };
    const add = (g: THREE.Object3D, name?: string) => {
      void name;
      return g;
    };
    void add;
    this.buildFrame(G('frame'), G('grid'));
    this.buildBinaryFaces(G('binaryFaces'));
    this.buildLiquidus(G('liquidus'));
    this.buildCurves(G('boundaries'), G('arrows'));
    this.buildInvariants(G('invariants'), G('planes'));
    this.buildCompounds(G('compounds'));
    this.resetRegion();
    this.vKey = '';
    this.vRas = null;
    this.isoSec = null;
    this.dirty = true;
    // 相机目标高度
    this.controls.target.set(0, this.H * 0.45, 0);
  }

  private label(parent: THREE.Object3D, pos: THREE.Vector3, html: string, cls = '') {
    const l = this.mkLabel(html, cls);
    l.position.copy(pos);
    parent.add(l);
    this.labelsStatic.push(l);
    return l;
  }

  private buildFrame(frame: THREE.Group, grid: THREE.Group) {
    const d = this.d!;
    const { Tmin, Tmax } = this.range;
    const V: Comp[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const bottom = V.map((v) => this.W(v, Tmin));
    const top = V.map((v) => this.W(v, Tmax));
    const edgeCol = hexNum(SCENE.edge);
    // 底面（淡）
    const bg = new THREE.BufferGeometry().setFromPoints([bottom[0], bottom[1], bottom[2]]);
    bg.setIndex([0, 1, 2]);
    frame.add(new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: hexNum(SCENE.background), side: THREE.DoubleSide, depthWrite: false })));
    // 外框
    frame.add(this.mkLineSeg([bottom[0], bottom[1], bottom[1], bottom[2], bottom[2], bottom[0], top[0], top[1], top[1], top[2], top[2], top[0]], edgeCol, 1));
    // 纯组元竖边
    const syms = d.params.components.map((c) => c.symbol);
    for (let i = 0; i < 3; i++) {
      frame.add(this.mkLine([bottom[i], top[i]], new THREE.Color(solidColor(i)).getHex(), 2.6));
      const p = bottom[i].clone();
      const out = new V3(p.x, 0, p.z).normalize().multiplyScalar(0.07);
      this.label(frame, new V3(p.x + out.x, p.y - 0.01, p.z + out.z), `<b style="color:${solidColor(i)}">${syms[i]}</b><small>${d.params.components[i].name}</small>`, 'vertex');
      const Tm = d.params.components[i].Tm;
      this.label(frame, this.W(V[i], Tm).add(new V3(out.x * 0.3, 0.012, out.z * 0.3)), `<span class="tm">熔点 ${(Tm - 273.15).toFixed(0)} °C</span>`, 'tiny');
    }
    // 侧面（淡）
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const g = new THREE.BufferGeometry().setFromPoints([bottom[i], bottom[j], top[j], top[i]]);
      g.setIndex([0, 1, 2, 0, 2, 3]);
      frame.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hexNum(SCENE.wall), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
    }
    // 温度刻度：水平细线 + 标注（A 竖边与 B 竖边）
    const pts: THREE.Vector3[] = [];
    for (let c = Math.ceil(toC(Tmin) / 100) * 100; c <= toC(Tmax); c += 100) {
      const T = c + 273.15;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        pts.push(this.W(V[i], T), this.W(V[j], T));
      }
      const pa = this.W(V[0], T);
      this.label(frame, new V3(pa.x - 0.065, pa.y, pa.z + 0.04), `${c}`, 'tick');
      const pb = this.W(V[1], T);
      this.label(frame, new V3(pb.x + 0.065, pb.y, pb.z + 0.04), `${c}`, 'tick');
    }
    frame.add(this.mkLineSeg(pts, hexNum(SCENE.frameLine), 0.55));
    this.label(frame, new V3(-0.62, this.H + 0.06, 0.34), '温度 T / °C', 'axis');
    // 成分网格与刻度
    const gp: THREE.Vector3[] = [];
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const q = (i + 2) % 3;
        const a: Comp = [0, 0, 0];
        const b: Comp = [0, 0, 0];
        a[i] = t;
        a[j] = 1 - t;
        b[i] = t;
        b[q] = 1 - t;
        gp.push(this.W(a, Tmin), this.W(b, Tmin));
      }
    }
    grid.add(this.mkLineSeg(gp, hexNum(SCENE.grid), 0.9));
    for (let k = 2; k <= 8; k += 2) {
      const t = k / 10;
      const pAB = this.W([1 - t, t, 0], Tmin);
      this.label(grid, pAB.add(new V3(0, -0.005, 0.045)), `${k * 10}`, 'tick dim');
      const pBC = this.W([0, 1 - t, t], Tmin);
      this.label(grid, pBC.add(new V3(0.045, -0.005, 0)), `${k * 10}`, 'tick dim');
      const pCA = this.W([t, 0, 1 - t], Tmin);
      this.label(grid, pCA.add(new V3(-0.045, -0.005, 0)), `${k * 10}`, 'tick dim');
    }
    this.label(grid, this.W([0.5, 0.5, 0], Tmin).add(new V3(0, 0, 0.12)), `${syms[1]} 含量 / %（沿 A→B）`, 'axis dim');
    void d;
  }

  private buildBinaryFaces(g: THREE.Group) {
    const d = this.d!;
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    for (const [i, j] of edges) {
      const N = 240;
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const linePts: THREE.Vector3[] = [];
      const lineCols: number[] = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const x: Comp = [0, 0, 0];
        x[i] = 1 - t;
        x[j] = t;
        const q = d.liquidusFast(x);
        const c = new THREE.Color(solidColor(q.si));
        const top = this.W(x, Math.max(this.range.Tmin, q.T));
        const bot = this.W(x, this.range.Tmin);
        pos.push(top.x, top.y, top.z, bot.x, bot.y, bot.z);
        col.push(c.r, c.g, c.b, 1, 1, 1);
        if (k > 0) {
          const a = (k - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        linePts.push(top);
        lineCols.push(c.getHex());
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      g.add(m);
      g.add(this.mkLine(linePts, lineCols, 2.2));
    }
    // 二元特征点
    for (const iv of d.topo.invariants) {
      if (iv.rank !== 'binary') continue;
      const p = this.W(iv.x, iv.T);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), new THREE.MeshBasicMaterial({ color: hexNum(iv.reaction.type === 'eutectic' ? COLOR.point.eutectic : COLOR.point.peritectic) }));
      s.position.copy(p);
      g.add(s);
      const out = new V3(p.x, 0, p.z).normalize().multiplyScalar(0.035);
      this.label(g, p.clone().add(new V3(out.x, 0.025, out.z)), `<b>${iv.label}</b> <span class="t">${cel(iv.T)}</span>`, 'binpt');
    }
  }

  private buildLiquidus(g: THREE.Group) {
    const d = this.d!;
    const N = LIQ_GRID_N;
    const rowStart: number[] = [];
    let nv = 0;
    for (let i = 0; i <= N; i++) {
      rowStart.push(nv);
      nv += N - i + 1;
    }
    const pos = new Float32Array(nv * 3);
    const tA = new Float32Array(nv * 4);
    const tB = new Float32Array(nv * 4);
    const grid = d.liquidusGrid();
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N - i; j++) {
        const v = rowStart[i] + j;
        const x: Comp = [i / N, j / N, (N - i - j) / N];
        let best = 0;
        for (let s = 0; s < 8; s++) {
          const t = grid[v * 8 + s];
          if (s < 4) tA[v * 4 + s] = t;
          else tB[v * 4 + s - 4] = t;
          if (t > best) best = t;
        }
        const p = this.W(x, best);
        pos[v * 3] = p.x;
        pos[v * 3 + 1] = p.y;
        pos[v * 3 + 2] = p.z;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N - i; j++) {
        const a = rowStart[i] + j;
        const b = rowStart[i + 1] + j;
        const c = rowStart[i] + j + 1;
        idx.push(a, b, c);
        if (i + j <= N - 2) idx.push(b, rowStart[i + 1] + j + 1, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('tA', new THREE.BufferAttribute(tA, 4));
    geo.setAttribute('tB', new THREE.BufferAttribute(tB, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const colors: THREE.Vector3[] = [];
    for (let s = 0; s < 8; s++) {
      const rgb = hexToRgb(SOLID_COLORS[s % SOLID_COLORS.length]);
      colors.push(new V3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));
    }
    const mat = new THREE.ShaderMaterial({
      vertexShader: LIQ_VERT,
      fragmentShader: LIQ_FRAG,
      uniforms: {
        uColors: { value: colors },
        uOpacity: { value: 0.85 },
        uCut: { value: 0 },
        uCutY: { value: 10 },
        uIso: { value: 1 },
        uIsoStep: { value: 50 },
        uMode: { value: 1 },
        uTmin: { value: this.range.Tmin },
        uTmax: { value: this.range.Tmax },
        uParula: { value: PARULA.map((c) => new V3(c[0], c[1], c[2])) },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
    this.liqMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    this.liqMesh = mesh;
    g.add(mesh);
    // 初晶面标注
    this.fieldLabels = [];
    for (const f of d.topo.fields) {
      if (f.area < 0.05) continue;
      const q = d.th.liquidus(f.centroid);
      const l = this.mkLabel(`${d.solids[f.si].label} 初晶面`, 'field');
      l.position.copy(this.W(f.centroid, q.T).add(new V3(0, 0.02, 0)));
      (l.element as HTMLElement).style.color = solidColor(f.si);
      g.add(l);
      this.labelsStatic.push(l);
      this.fieldLabels.push(l);
    }
  }

  private buildCurves(g: THREE.Group, arrows: THREE.Group) {
    const d = this.d!;
    const colOf = { eutectic: hexNum(COLOR.line.eutectic), transition: hexNum(COLOR.line.transition), peritectic: hexNum(COLOR.line.peritectic) } as const;
    const coneGeo = new THREE.ConeGeometry(0.014, 0.04, 14);
    coneGeo.rotateX(Math.PI / 2); // 尖端指向 +Z
    for (const cv of d.topo.curves) {
      for (const pc of cv.pieces) {
        const lo = Math.min(pc.i0, pc.i1);
        const hi = Math.max(pc.i0, pc.i1);
        const pts: THREE.Vector3[] = [];
        for (let k = lo; k <= hi; k++) pts.push(this.W(cv.pts[k], cv.T[k]).add(new V3(0, 0.003, 0)));
        const line = this.mkLine(pts, colOf[pc.kind], pc.kind === 'eutectic' ? 2.4 : 3, { clip: true });
        line.userData = { curve: cv.id };
        g.add(line);
        // 箭头
        const dir = pc.i1 >= pc.i0 ? 1 : -1;
        const km = Math.round((pc.i0 + pc.i1) / 2);
        const k0 = Math.max(0, Math.min(cv.pts.length - 2, dir === 1 ? km : km - 1));
        const p0 = this.W(cv.pts[k0], cv.T[k0]);
        const p1 = this.W(cv.pts[k0 + 1], cv.T[k0 + 1]);
        const tangent = p1.clone().sub(p0).multiplyScalar(dir);
        if (tangent.length() < 1e-9) continue;
        tangent.normalize();
        const n = pc.kind === 'eutectic' ? 1 : 2;
        for (let q = 0; q < n; q++) {
          const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: colOf[pc.kind], clippingPlanes: [this.cutPlane] }));
          cone.position.copy(p0.clone().add(p1).multiplyScalar(0.5).addScaledVector(tangent, -q * 0.034).add(new V3(0, 0.004, 0)));
          cone.quaternion.setFromUnitVectors(new V3(0, 0, 1), tangent);
          cone.scale.setScalar(1);
          arrows.add(cone);
        }
      }
      for (const mi of cv.maxima) {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.016), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.compound[0]) }));
        m.position.copy(this.W(cv.pts[mi], cv.T[mi]));
        arrows.add(m);
        this.label(arrows, m.position.clone().add(new V3(0, 0.035, 0)), `<span class="tm">温度极大点 ${cel(cv.T[mi])}</span>`, 'tiny');
      }
    }
  }

  private buildInvariants(g: THREE.Group, planes: THREE.Group) {
    const d = this.d!;
    for (const iv of d.topo.invariants) {
      if (iv.rank !== 'ternary') continue;
      const col = hexNum(COLOR.point[iv.reaction.type]);
      const p = this.W(iv.x, iv.T);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.02, 18, 14), new THREE.MeshBasicMaterial({ color: col, clippingPlanes: [this.cutPlane] }));
      s.position.copy(p);
      s.userData = { inv: iv.id };
      g.add(s);
      const pick = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.copy(p);
      pick.userData = { inv: iv.id };
      g.add(pick);
      this.invPickers.push(pick);
      const hex = '#' + new THREE.Color(col).getHexString();
      this.label(g, p.clone().add(new V3(0.03, 0.045, 0)), `<b style="color:${hex}">${iv.label}</b> <span class="t">${cel(iv.T)}</span>`, 'invpt');
      // 不变反应平面：三固相成分三角形
      const tri = iv.solids.map((si, k) => this.W(iv.solidX[k] ?? d.solids[si].n, iv.T));
      const geo = new THREE.BufferGeometry().setFromPoints(tri);
      geo.setIndex([0, 1, 2]);
      planes.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })));
      planes.add(this.mkLine([tri[0], tri[1], tri[2], tri[0]], col, 1.6, { opacity: 0.9 }));
      // 液相点到三个固相点的细线
      planes.add(this.mkLineSeg([p, tri[0], p, tri[1], p, tri[2]], col, 0.55));
    }
  }

  private buildCompounds(g: THREE.Group) {
    const d = this.d!;
    for (const ci of d.topo.compounds) {
      const s = d.solids[ci.si];
      const colHex = new THREE.Color(solidColor(s.index)).getHex();
      const top = ci.Tdecomp ?? ci.Thyp;
      const bot = this.W(s.n, this.range.Tmin);
      const mid = this.W(s.n, top);
      g.add(this.mkLine([bot, mid], colHex, 3.6));
      const css = solidColor(s.index);
      const kind = ci.congruent ? `熔点 ${cel(top)}` : `${cel(top)} 包晶分解`;
      this.label(g, mid.clone().add(new V3(0, 0.05, 0)), `<b style="color:${css}">${s.label}</b> <span class="t">${s.formula}</span><br><span class="tm">${ci.congruent ? '稳定·一致熔融' : '不稳定·不一致熔融'}</span><br><span class="tm">${kind}</span>`, 'compound');
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), new THREE.MeshBasicMaterial({ color: colHex }));
      dot.position.copy(mid);
      g.add(dot);
      if (!ci.congruent) {
        const hyp = this.W(s.n, ci.Thyp);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 8, 24), new THREE.MeshBasicMaterial({ color: colHex }));
        ring.position.copy(hyp);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        if (Math.abs(hyp.y - mid.y) > 0.01) g.add(this.mkLine([mid, hyp], colHex, 1.6, { dashed: true, opacity: 0.8 }));
        this.detailLabels.push({ si: ci.si, l: this.label(g, hyp.clone().add(new V3(0.045, -0.01, 0)), `<span class="tm">假想熔点（亚稳）${cel(ci.Thyp)}</span>`, 'tiny') });
        // 该成分点处实际液相线
        const act = this.W(s.n, ci.Tliq);
        const mk = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.black) }));
        mk.position.copy(act);
        g.add(mk);
        g.add(this.mkLine([hyp, act], hexNum(SCENE.hypothetical), 1.2, { dashed: true, opacity: 0.8 }));
        this.detailLabels.push({ si: ci.si, l: this.label(g, act.clone().add(new V3(0.045, 0.012, 0)), `<span class="tm">此处实际液相线 ${cel(ci.Tliq)}（${d.solids[ci.liqSi].label} 初晶）</span>`, 'tiny') });
      }
    }
  }

  // ------------------------------------------------------------ 截面平面
  private initIso() {
    this.isoCanvas.width = 768;
    this.isoCanvas.height = 768;
    this.isoTex = new THREE.CanvasTexture(this.isoCanvas);
    this.isoTex.anisotropy = 8;
    this.isoTex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.BufferGeometry();
    const L = triLayout(768, 768, 56);
    const V: Comp[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    for (const v of V) {
      const [u, w] = toXY(v);
      pos.push(u - 0.5, 0, H0 - w);
      const p = L.px(v);
      uv.push(p[0] / 768, 1 - p[1] / 768);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2]);
    const mat = new THREE.MeshBasicMaterial({ map: this.isoTex, transparent: true, opacity: 0.97, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    this.isoMesh = new THREE.Mesh(geo, mat);
    this.isoMesh.renderOrder = 3;
    this.dyn.add(this.isoMesh);
    // 外框
    const outline = this.mkLine([new V3(-0.5, 0, H0), new V3(0.5, 0, H0), new V3(0, 0, H0 - SQRT3_2), new V3(-0.5, 0, H0)], hexNum(COLOR.accent), 2);
    outline.name = 'isoOutline';
    this.isoMesh.add(outline);
    // T 手柄
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 14), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.accent) }));
    h.renderOrder = 6;
    this.isoMesh.add(h);
    h.position.set(0.5, 0, H0);
    this.handles.push({ mesh: h, kind: 'T' });
    this.tLabel = this.mkLabel('', 'tlabel');
    this.tLabel.position.set(0.5, 0.028, H0);
    this.isoMesh.add(this.tLabel);
    (h.material as THREE.MeshBasicMaterial).depthTest = false;
  }

  private initVert() {
    this.vCanvas.width = 640;
    this.vCanvas.height = 460;
    this.vTex = new THREE.CanvasTexture(this.vCanvas);
    this.vTex.anisotropy = 8;
    this.vTex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.vMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.vTex, transparent: true, opacity: 0.97, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    this.vMesh.renderOrder = 2;
    this.dyn.add(this.vMesh);
    for (const kind of ['p1', 'p2'] as const) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.03, 18, 14), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.accent2), depthTest: false }));
      h.renderOrder = 6;
      this.dyn.add(h);
      this.handles.push({ mesh: h, kind });
    }
    const hs = new THREE.Mesh(new THREE.SphereGeometry(0.035, 18, 14), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.stateX0), depthTest: false }));
    hs.renderOrder = 7;
    this.dyn.add(hs);
    this.handles.push({ mesh: hs, kind: 'state' });
  }

  private updateIso(s: SceneState) {
    if (!this.isoMesh || !this.isoTex) return;
    this.isoMesh.visible = s.isoOn;
    this.isoMesh.position.y = this.yOf(s.T);
    const { sec } = isoOf(s.diagram, s.T);
    if (sec && sec !== this.isoSec) {
      this.isoSec = sec;
      const ctx = this.isoCanvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 768, 768);
      drawIso(ctx, 768, 768, sec, s.diagram, THEME_LIGHT, { pad: 56, grid: true, ticks: false, labels: true, ties: true, fontPx: 22 });
      this.isoTex.needsUpdate = true;
    }
    if (this.tLabel) {
      (this.tLabel.element as HTMLElement).innerHTML = `T = ${cel(s.T)} <i>⇕</i>`;
    }
  }

  private updateVert(s: SceneState, spec: VerticalSpec) {
    if (!this.vMesh || !this.vTex) return;
    this.vMesh.visible = s.vertOn;
    const a = this.W(spec.p1, this.range.Tmin);
    const b = this.W(spec.p2, this.range.Tmin);
    const aT = this.W(spec.p1, this.range.Tmax);
    const bT = this.W(spec.p2, this.range.Tmax);
    const pos = this.vMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.setXYZ(2, bT.x, bT.y, bT.z);
    pos.setXYZ(3, aT.x, aT.y, aT.z);
    pos.needsUpdate = true;
    this.vMesh.geometry.computeBoundingSphere();
    this.vMesh.geometry.computeBoundingBox();
    const key = `${s.diagram.uid}|${spec.p1.map((v) => v.toFixed(4))}|${spec.p2.map((v) => v.toFixed(4))}`;
    const paint = (ras: VerticalRaster, W: number, H: number) => {
      const ctx = this.vCanvas.getContext('2d')!;
      ctx.setTransform(this.vCanvas.width / W, 0, 0, this.vCanvas.height / H, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawVertical(ctx, W, H, ras, s.diagram, spec, THEME_LIGHT, { margin: { l: 0, r: 0, t: 0, b: 0 }, fontPx: 16 * (W / 640) * 1.0, labels: true, axes: false, liquidAlpha: 40 });
      this.vTex!.needsUpdate = true;
      this.dirty = true;
    };
    if (useWorkerFor(s.diagram.params)) {
      // 固溶体体系：栅格在 Worker 中计算（先粗后精），结果到达后经 asyncTick 触发本函数重绘
      const { ras } = verticalOf(s.diagram, spec, 640, 460, this.range.Tmin, this.range.Tmax);
      if (ras && ras !== this.vRas) {
        this.vRas = ras;
        paint(ras, ras.W, ras.H);
      }
      this.vKey = key;
    } else if (key !== this.vKey) {
      this.vKey = key;
      const draw = (W: number, H: number) => {
        const { ras } = verticalOf(s.diagram, spec, W, H, this.range.Tmin, this.range.Tmax);
        if (ras) paint(ras, W, H);
      };
      draw(160, 115);
      window.clearTimeout(this.vTimer);
      this.vTimer = window.setTimeout(() => draw(640, 460), 120);
    }
    // 外框与手柄
    if (this.vOutlineKey !== key) {
      this.vOutlineKey = key;
      this.setVertOutline(a, b, aT, bT);
    }
    if (this.vOutline) this.vOutline.visible = s.vertOn;
    for (const h of this.handles) {
      if (h.kind === 'p1') h.mesh.position.copy(a).add(new V3(0, 0.002, 0));
      if (h.kind === 'p2') h.mesh.position.copy(b).add(new V3(0, 0.002, 0));
      if (h.kind === 'p1' || h.kind === 'p2') h.mesh.visible = s.vertOn && s.section.mode !== 'join' && !(s.section.mode === 'vertex' && h.kind === 'p1');
    }
  }

  private vOutline: Line2 | null = null;
  private vOutlineKey = '';
  private vTLine: Line2 | null = null;
  private setVertOutline(a: THREE.Vector3, b: THREE.Vector3, aT: THREE.Vector3, bT: THREE.Vector3) {
    if (this.vOutline) {
      this.vOutline.removeFromParent();
      this.vOutline.geometry.dispose();
    }
    this.vOutline = this.mkLine([a, b, bT, aT, a], hexNum(COLOR.accent2), 1.8);
    this.dyn.add(this.vOutline);
  }

  // ------------------------------------------------------------ 状态
  setState(s: SceneState) {
    const prev = this.st;
    this.st = s;
    const ts = s.layers.tScale;
    if (ts !== this.tScale) {
      this.tScale = ts;
      this.H = HEIGHT0 * ts;
    }
    if (!prev || prev.diagram !== s.diagram || prev.layers.tScale !== ts) {
      this.setDiagram(s.diagram);
      if (prev && prev.diagram === s.diagram) {
        this.controls.target.set(0, this.H * 0.45, 0);
        if (!this.userMoved) this.fitCamera(new V3(1.42, 1.18, 1.72), new V3(0, this.H * 0.45, 0));
      }
    }
    const d = s.diagram;
    const spec = resolveSection(s.section, d, s.x0);
    this.spec = spec;
    const L = s.layers;
    const g = this.groups;
    if (g.liquidus) g.liquidus.visible = L.liquidus;
    if (g.boundaries) g.boundaries.visible = L.boundaries;
    if (g.arrows) g.arrows.visible = L.arrows && L.boundaries;
    if (g.invariants) g.invariants.visible = L.invariants;
    if (g.planes) g.planes.visible = L.planes;
    if (g.compounds) g.compounds.visible = L.compounds;
    if (g.binaryFaces) g.binaryFaces.visible = L.binaryFaces;
    if (g.grid) g.grid.visible = L.grid;
    this.fieldLabels.forEach((l) => (l.visible = L.fieldLabels && L.liquidus));
    if (this.liqMat) {
      this.liqMat.uniforms.uOpacity.value = L.opacity;
      this.liqMat.transparent = L.opacity < 0.995;
      this.liqMat.depthWrite = L.opacity >= 0.995;
      this.liqMat.uniforms.uIso.value = L.isotherms ? 1 : 0;
      this.liqMat.uniforms.uMode.value = L.surfaceColor === 'temperature' ? 1 : 0;
      const cut = L.cutaway && s.isoOn;
      this.liqMat.uniforms.uCut.value = cut ? 1 : 0;
      this.liqMat.uniforms.uCutY.value = this.yOf(s.T) + 0.0005;
    }
    // 剖切平面：保留 y <= T 的部分
    const cut = L.cutaway && s.isoOn;
    this.cutPlane.set(new V3(0, -1, 0), cut ? this.yOf(s.T) + 0.0005 : 10);
    this.syncLabels(s);
    this.updateIso(s);
    this.updateVert(s, spec);
    this.updateState(s);
    this.updateRegion(s);
    // 垂直截面上的当前温度线
    this.updateTLine(s, spec);
    this.dirty = true;
  }

  /** CSS2D 标签不继承父级可见性：按图层与剖切高度手动同步 */
  private syncLabels(s: SceneState) {
    const cutOn = s.layers.cutaway && s.isoOn;
    const cutY = this.yOf(s.T) + 0.0005;
    for (const l of this.labelsStatic) {
      const gname = l.parent?.name ?? '';
      const g = this.groups[gname];
      let vis = g ? g.visible : true;
      if (gname === 'frame' || gname === 'grid') vis = g ? g.visible : true;
      if (vis && cutOn && l.position.y > cutY + 0.01 && gname !== 'frame') vis = false;
      if (gname === 'liquidus' && !s.layers.fieldLabels) vis = false;
      l.visible = vis;
    }
    for (const dl of this.detailLabels) dl.l.visible = dl.l.visible && s.selection?.kind === 'compound' && s.selection.si === dl.si;
    if (this.tLabel) this.tLabel.visible = s.isoOn;
  }

  private updateTLine(s: SceneState, spec: VerticalSpec) {
    if (this.vTLine) {
      this.vTLine.removeFromParent();
      this.vTLine.geometry.dispose();
      this.vTLine = null;
    }
    if (!s.vertOn) return;
    const a = this.W(spec.p1, s.T).add(new V3(0, 0.001, 0));
    const b = this.W(spec.p2, s.T).add(new V3(0, 0.001, 0));
    this.vTLine = this.mkLine([a, b], hexNum(COLOR.accent), 1.8, { dashed: true });
    this.dyn.add(this.vTLine);
  }

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      c.removeFromParent();
      disposeObject(c);
    }
  }

  private stateLabels: CSS2DObject[] = [];
  private updateState(s: SceneState) {
    const d = s.diagram;
    this.clearGroup(this.stateGroup);
    this.stateLabels.forEach((l) => l.removeFromParent());
    this.stateLabels = [];
    const base = this.W(s.x0, this.range.Tmin);
    const p = this.W(s.x0, s.T);
    // 成分竖线
    this.stateGroup.add(this.mkLine([base, this.W(s.x0, this.range.Tmax)], hexNum(COLOR.stateX0), 1.2, { dashed: true, opacity: 0.8 }));
    const hs = this.handles.find((h) => h.kind === 'state')!;
    hs.mesh.position.copy(p);
    // 平衡相标记 / 连结线
    const eq = s.eq;
    const pts = eq.phases.map((q) => ({ p: this.W(q.x, s.T), q }));
    if (s.layers.tieTriangle) {
      if (pts.length === 2) this.stateGroup.add(this.mkLine([pts[0].p, pts[1].p], hexNum(COLOR.black), 2));
      if (pts.length === 3) {
        const geo = new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.p));
        geo.setIndex([0, 1, 2]);
        this.stateGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hexNum(SCENE.black), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
        this.stateGroup.add(this.mkLine([pts[0].p, pts[1].p, pts[2].p, pts[0].p], hexNum(COLOR.black), 2));
      }
      if (pts.length === 4) {
        // 四相不变反应：液相点与三固相点（连结线 + 固相三角形）
        const L0 = pts.find((q) => q.q.si < 0) ?? pts[0];
        const sol = pts.filter((q) => q !== L0);
        this.stateGroup.add(this.mkLineSeg([L0.p, sol[0].p, L0.p, sol[1].p, L0.p, sol[2].p], hexNum(COLOR.black), 0.9));
        const geo = new THREE.BufferGeometry().setFromPoints(sol.map((q) => q.p));
        geo.setIndex([0, 1, 2]);
        this.stateGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hexNum(COLOR.compound[0]), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })));
        this.stateGroup.add(this.mkLine([sol[0].p, sol[1].p, sol[2].p, sol[0].p], hexNum(SCENE.tieEdge), 2));
      }
      if (pts.length > 1) {
        for (const q of pts) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(phaseColor(d, q.q.id)), depthTest: false }));
          m.position.copy(q.p);
          m.renderOrder = 5;
          this.stateGroup.add(m);
          const l = this.mkLabel(`${q.q.id === 'L' ? 'L' : q.q.id} ${(q.q.frac * 100).toFixed(0)}%`, 'phlabel');
          l.position.copy(q.p.clone().add(new V3(0.02, 0.025, 0)));
          (l.element as HTMLElement).style.borderColor = phaseColor(d, q.q.id);
          this.stateGroup.add(l);
          this.stateLabels.push(l);
        }
      }
    }
    // 结晶路径
    this.clearGroup(this.pathGroup);
    if (s.layers.path) {
      const cur = s.trace.samples[Math.min(s.trace.samples.length - 1, Math.round(s.idx))];
      const done: THREE.Vector3[] = [];
      const all: THREE.Vector3[] = [];
      for (const q of s.trace.liquidPath) {
        const w = this.W(q.x, q.T).add(new V3(0, 0.004, 0));
        all.push(w);
        if (q.t <= cur.t + 1e-9) done.push(w);
      }
      if (all.length > 1) this.pathGroup.add(this.mkLine(all, hexNum(COLOR.path), 1.4, { dashed: true, opacity: 0.55 }));
      if (done.length > 1) this.pathGroup.add(this.mkLine(done, hexNum(COLOR.path), 3));
      if (done.length) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), new THREE.MeshBasicMaterial({ color: hexNum(COLOR.path), depthTest: false }));
        m.position.copy(done[done.length - 1]);
        m.renderOrder = 5;
        this.pathGroup.add(m);
      }
    }
  }

  // 选中相区的空间包络（层析叠合）
  private resetRegion() {
    this.clearGroup(this.regionGroup);
    this.regionKey = '';
  }
  private updateRegion(s: SceneState) {
    const key = s.selection?.kind === 'region' ? `${s.diagram.uid}|${s.selection.key}` : '';
    if (key === this.regionKey) return;
    this.resetRegion();
    this.regionKey = key;
    if (!key || s.selection?.kind !== 'region') return;
    const rk = s.selection.key;
    const d = s.diagram;
    const col = regionRgb(d, rk, true);
    const c = new THREE.Color(col[0] / 255, col[1] / 255, col[2] / 255);
    const pos: number[] = [];
    const ln: THREE.Vector3[] = [];
    const nS = 36;
    const Ts = Array.from({ length: nS + 1 }, (_, k) => this.range.Tmin + 10 + (k / nS) * (this.range.Tmax - this.range.Tmin - 10));
    const slices = regionSlicesOf(d, rk, Ts);
    if (!slices) {
      // 固溶体体系：Worker 中计算，结果到达（asyncTick）后重试
      this.regionKey = '';
      return;
    }
    for (const { T, polys } of slices) {
      for (const poly of polys) {
        const p0 = this.W(poly[0], T);
        for (let i = 1; i < poly.length - 1; i++) {
          const p1 = this.W(poly[i], T);
          const p2 = this.W(poly[i + 1], T);
          pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
        for (let i = 0; i < poly.length; i++) {
          const a = this.W(poly[i], T);
          const b = this.W(poly[(i + 1) % poly.length], T);
          ln.push(a, b);
        }
      }
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.regionGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.2), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
      this.regionGroup.add(this.mkLineSeg(ln, c.clone().lerp(new THREE.Color(1, 1, 1), 0.5).getHex(), 0.35));
    }
  }

  // ------------------------------------------------------------ 相机预设
  setView(kind: 'iso' | 'top' | 'front' | 'side' | 'section') {
    const t = new V3(0, this.H * 0.45, 0);
    let pos = new V3(1.42, 1.18, 1.72);
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = Math.max(1.62 * this.H / (2 * Math.tan(vf / 2)) + 0.5, 1.55 / (2 * Math.tan(hf / 2)));
    if (kind === 'iso') pos = t.clone().addScaledVector(pos.clone().sub(t).normalize(), dist);
    if (kind === 'top') {
      pos = new V3(0, Math.max(2.4, dist * 0.95), 0.001);
      t.set(0, 0, 0);
    } else if (kind === 'front') pos = new V3(0, this.H * 0.5, dist);
    else if (kind === 'side') pos = new V3(dist, this.H * 0.5, 0);
    else if (kind === 'section') {
      const a = this.W(this.spec.p1, 0);
      const b = this.W(this.spec.p2, 0);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a).normalize();
      let n = new V3(-dir.z, 0, dir.x);
      const toCam = new V3(1.42, 0, 1.72);
      if (n.dot(toCam) < 0) n = n.multiplyScalar(-1);
      t.set(mid.x, this.H * 0.5, mid.z);
      pos = t.clone().addScaledVector(n, dist * 0.85);
    }
    const from = this.camera.position.clone();
    const fromT = this.controls.target.clone();
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 520);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(from, pos, e);
      this.controls.target.lerpVectors(fromT, t, e);
      this.controls.update();
      this.dirty = true;
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  // ------------------------------------------------------------ 交互
  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pickHandle(e: PointerEvent): Handle | null {
    this.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const vis = this.handles.filter((h) => h.mesh.visible && (h.kind !== 'T' || this.st?.isoOn) && (h.kind !== 'state'));
    const hs = this.handles.find((h) => h.kind === 'state');
    const list = [...(hs ? [hs] : []), ...vis];
    const hits = this.ray.intersectObjects(list.map((h) => h.mesh), false);
    if (!hits.length) return null;
    return list.find((h) => h.mesh === hits[0].object) ?? null;
  }

  private rayPlaneY(e: PointerEvent, y: number): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const pl = new THREE.Plane(new V3(0, 1, 0), -y);
    const out = new V3();
    return this.ray.ray.intersectPlane(pl, out) ? out : null;
  }

  private rayVertical(e: PointerEvent, through: THREE.Vector3): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const dir = new V3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, through);
    const out = new V3();
    return this.ray.ray.intersectPlane(pl, out) ? out : null;
  }

  private onDown = (e: PointerEvent) => {
    const s = this.st;
    if (!s || e.button !== 0) return;
    const base = { startPx: [e.clientX, e.clientY] as [number, number], moved: false, startSpec: this.spec, hit: new V3(), startHit: new V3(), startY: 0, startT: s.T };
    const h = this.pickHandle(e);
    if (h) {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      if (h.kind === 'T') {
        const p = h.mesh.getWorldPosition(new V3());
        const hit = this.rayVertical(e, p) ?? p;
        this.drag = { ...base, kind: 'T', startHit: hit, startY: hit.y, startT: s.T };
      } else this.drag = { ...base, kind: h.kind };
      return;
    }
    // 平面
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const cand: THREE.Object3D[] = [];
    if (this.isoMesh && s.isoOn) cand.push(this.isoMesh);
    if (this.vMesh && s.vertOn) cand.push(this.vMesh);
    const hit = this.ray.intersectObjects(cand, false)[0];
    // 与液相面比较深度（不被不透明液相面遮住）
    let blocked = false;
    if (hit && this.liqMesh && this.groups.liquidus?.visible && (this.liqMat?.uniforms.uOpacity.value ?? 1) > 0.97) {
      const lh = this.ray.intersectObject(this.liqMesh, false).find((q) => !(this.liqMat!.uniforms.uCut.value > 0.5 && q.point.y > this.liqMat!.uniforms.uCutY.value));
      if (lh && lh.distance < hit.distance - 1e-4) blocked = true;
    }
    if (hit && !blocked) {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      if (hit.object === this.isoMesh) this.drag = { ...base, kind: 'ibody', startHit: hit.point.clone(), startY: hit.point.y, hit: hit.point.clone() };
      else this.drag = { ...base, kind: 'vbody', startHit: hit.point.clone(), startY: hit.point.y, hit: hit.point.clone() };
      return;
    }
    // 不变点拾取
    const inv = this.ray.intersectObjects(this.invPickers, false)[0];
    if (inv && !blocked) {
      this.drag = null;
      this.cb.onSelect({ kind: 'invariant', id: inv.object.userData.inv });
      return;
    }
    // 其余交给轨道控制；单击液相面选择初晶区在 onUp 处理
    this.pendingClick = { x: e.clientX, y: e.clientY };
  };
  private pendingClick: { x: number; y: number } | null = null;

  private onMove = (e: PointerEvent) => {
    const s = this.st;
    if (!s) return;
    const dr = this.drag;
    if (!dr) {
      this.hover(e);
      return;
    }
    const mv = Math.hypot(e.clientX - dr.startPx[0], e.clientY - dr.startPx[1]);
    if (mv > 4) dr.moved = true;
    const d = s.diagram;
    if (dr.kind === 'T' || (dr.kind === 'ibody' && dr.moved)) {
      const p = dr.startHit;
      const hit = this.rayVertical(e, p);
      if (hit) {
        const Tn = dr.startT + ((hit.y - dr.startY) / this.H) * (this.range.Tmax - this.range.Tmin);
        this.cb.onSetT(Tn);
      }
    } else if (dr.kind === 'state') {
      const hit = this.rayPlaneY(e, this.yOf(s.T));
      if (hit) this.cb.onSetX0(this.clampComp(this.compOfXZ(hit.x, hit.z)));
    } else if (dr.kind === 'p1' || dr.kind === 'p2') {
      const hit = this.rayPlaneY(e, 0);
      if (hit) this.dragSection(nearestOnPerimeter(this.clampComp(this.compOfXZ(hit.x, hit.z))), dr.kind, this.clampComp(this.compOfXZ(hit.x, hit.z)));
    } else if (dr.kind === 'vbody' && dr.moved) {
      const hit = this.rayPlaneY(e, dr.startHit.y);
      if (hit) this.dragBody(hit, dr);
    }
    void d;
  };

  /** 拖动端点：按定位模式把指针位置映射为参数 */
  private dragSection(onPerim: Comp, which: 'p1' | 'p2', raw: Comp) {
    const s = this.st!;
    const cfg = s.section;
    switch (cfg.mode) {
      case 'free':
        this.cb.onSection(which === 'p1' ? { p1: onPerim } : { p2: onPerim });
        break;
      case 'join': {
        const sp = this.spec;
        this.cb.onSection(which === 'p1' ? { mode: 'free', p1: onPerim, p2: sp.p2 } : { mode: 'free', p1: sp.p1, p2: onPerim });
        break;
      }
      case 'parallel':
        this.cb.onSection({ fixedValue: Math.min(0.99, Math.max(0.01, raw[cfg.fixedComp])) });
        break;
      case 'vertex': {
        const v = cfg.vertex;
        const j = (v + 1) % 3;
        const k = (v + 2) % 3;
        const den = onPerim[j] + onPerim[k];
        if (den > 1e-6) this.cb.onSection({ ratio: Math.min(1, Math.max(0, onPerim[k] / den)) });
        break;
      }
      case 'point': {
        const P = toXY(s.x0);
        const Q = toXY(raw);
        const ang = Math.atan2(Q[1] - P[1], Q[0] - P[0]);
        this.cb.onSection({ angle: which === 'p1' ? ang + Math.PI : ang });
        break;
      }
    }
  }

  private dragBody(hit: THREE.Vector3, dr: NonNullable<PhaseScene['drag']>) {
    const s = this.st!;
    const cfg = s.section;
    const raw = this.clampComp(this.compOfXZ(hit.x, hit.z));
    switch (cfg.mode) {
      case 'parallel':
        this.cb.onSection({ fixedValue: Math.min(0.99, Math.max(0.01, raw[cfg.fixedComp])) });
        break;
      case 'vertex': {
        const V: Comp = [0, 0, 0];
        V[cfg.vertex] = 1;
        const A = toXY(V);
        const Q = toXY(raw);
        const [, far] = perimeterLine(V, Q[0] - A[0], Q[1] - A[1]);
        const v = cfg.vertex;
        const j = (v + 1) % 3;
        const k = (v + 2) % 3;
        const den = far[j] + far[k];
        if (den > 1e-6) this.cb.onSection({ ratio: Math.min(1, Math.max(0, far[k] / den)) });
        break;
      }
      case 'point': {
        const P = toXY(s.x0);
        const Q = toXY(raw);
        this.cb.onSection({ angle: Math.atan2(Q[1] - P[1], Q[0] - P[0]) });
        break;
      }
      default: {
        // free / join：沿截面法向平移（join 自动转为 free）
        const sp = dr.startSpec;
        const P = toXY(sp.p1);
        const Qp = toXY(sp.p2);
        const dx = Qp[0] - P[0];
        const dy = Qp[1] - P[1];
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const start = this.compOfXZ(dr.startHit.x, dr.startHit.z);
        const S0 = toXY(start);
        const S1 = toXY(raw);
        const shift = (S1[0] - S0[0]) * nx + (S1[1] - S0[1]) * ny;
        const mid = lerpComp(sp.p1, sp.p2, 0.5);
        const M = toXY(mid);
        const Mn = [M[0] + nx * shift, M[1] + ny * shift];
        const cc = Mn[1] / SQRT3_2;
        const bb = Mn[0] - 0.5 * cc;
        const center = this.clampComp([1 - bb - cc, bb, cc]);
        const [a, b] = perimeterLine(center, dx / len, dy / len);
        this.cb.onSection({ mode: 'free', p1: a, p2: b });
      }
    }
  }

  private onUp = (e: PointerEvent) => {
    const s = this.st;
    const dr = this.drag;
    if (dr) {
      this.controls.enabled = true;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // 单击（未拖动）平面：取点
      if (!dr.moved && s) {
        if (dr.kind === 'ibody') this.cb.onSetX0(this.clampComp(this.compOfXZ(dr.startHit.x, dr.startHit.z)));
        if (dr.kind === 'vbody') {
          const xx = this.compOfXZ(dr.startHit.x, dr.startHit.z);
          // 投影到截面线上
          const P = toXY(this.spec.p1);
          const Q = toXY(this.spec.p2);
          const X = toXY(xx);
          const dx = Q[0] - P[0];
          const dy = Q[1] - P[1];
          const u = Math.min(1, Math.max(0, ((X[0] - P[0]) * dx + (X[1] - P[1]) * dy) / (dx * dx + dy * dy || 1)));
          this.cb.onSetT(this.TofY(dr.startHit.y));
          this.cb.onSetX0(lerpComp(this.spec.p1, this.spec.p2, u));
        }
      }
      this.drag = null;
      return;
    }
    // 单击液相面 → 选中初晶区
    const pc = this.pendingClick;
    this.pendingClick = null;
    if (pc && s && Math.hypot(e.clientX - pc.x, e.clientY - pc.y) < 4) {
      const hit = this.pickLiquidus(e);
      if (hit) this.cb.onSelect({ kind: 'field', si: hit.si });
      else this.cb.onSelect(null);
    }
  };

  private pickLiquidus(e: PointerEvent): { x: Comp; T: number; si: number } | null {
    const s = this.st;
    if (!s || !this.liqMesh || !this.groups.liquidus?.visible) return null;
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObject(this.liqMesh, false);
    const cutOn = this.liqMat!.uniforms.uCut.value > 0.5;
    const hit = hits.find((q) => !(cutOn && q.point.y > this.liqMat!.uniforms.uCutY.value));
    if (!hit) return null;
    const x = this.clampComp(this.compOfXZ(hit.point.x, hit.point.z));
    const q = s.diagram.liquidus(x);
    return { x, T: q.T, si: q.si };
  }

  private hover(e: PointerEvent) {
    const s = this.st;
    if (!s) return;
    const dom = this.renderer.domElement;
    const h = this.pickHandle(e);
    const r = dom.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (h) {
      dom.style.cursor = h.kind === 'T' ? 'ns-resize' : 'grab';
      this.cb.onHover({ text: h.kind === 'T' ? '拖动：升降等温截面' : h.kind === 'state' ? '拖动：改变总成分' : '拖动：旋转垂直截面', x: px, y: py });
      return;
    }
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const cand: THREE.Object3D[] = [];
    if (this.isoMesh && s.isoOn) cand.push(this.isoMesh);
    if (this.vMesh && s.vertOn) cand.push(this.vMesh);
    const ph = this.ray.intersectObjects(cand, false)[0];
    const inv = this.ray.intersectObjects(this.invPickers, false)[0];
    if (inv && (!ph || inv.distance < ph.distance)) {
      const iv = s.diagram.topo.invariants.find((v) => v.id === inv.object.userData.inv)!;
      dom.style.cursor = 'pointer';
      this.cb.onHover({ text: `${iv.label}：${iv.name}`, sub: `${iv.reaction.text} · ${cel(iv.T, 1)}`, x: px, y: py });
      return;
    }
    if (ph) {
      if (ph.object === this.isoMesh) {
        dom.style.cursor = 'ns-resize';
        const x = this.clampComp(this.compOfXZ(ph.point.x, ph.point.z));
        const eq = s.diagram.equilibrium(x, s.T);
        this.cb.onHover({ text: `等温截面 ${cel(s.T)}`, sub: `${eq.key} · 拖动升降，单击取点`, x: px, y: py });
      } else {
        dom.style.cursor = 'move';
        const T = this.TofY(ph.point.y);
        const xx = this.clampComp(this.compOfXZ(ph.point.x, ph.point.z));
        this.cb.onHover({ text: `垂直截面 ${cel(T)}`, sub: `${s.diagram.equilibrium(xx, T).key} · 拖动平移，单击取点`, x: px, y: py });
      }
      return;
    }
    dom.style.cursor = 'grab';
    const lq = this.pickLiquidus(e);
    if (lq) {
      const sym = s.diagram.params.components.map((c) => c.symbol);
      this.cb.onHover({ text: `${s.diagram.solids[lq.si].label} 初晶面 · 液相线 ${cel(lq.T)}`, sub: `${sym[0]} ${(lq.x[0] * 100).toFixed(1)} · ${sym[1]} ${(lq.x[1] * 100).toFixed(1)} · ${sym[2]} ${(lq.x[2] * 100).toFixed(1)} %`, x: px, y: py });
    } else this.cb.onHover(null);
  }
}
