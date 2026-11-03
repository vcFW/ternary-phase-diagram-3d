import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { colormapGradient } from '../core/colormap';
import { formatC, regionName } from '../core/phases';
import { useStore, type ViewPreset } from '../state/store';
import { dragState } from './dragState';
import { Frame } from './Frame';
import { Markers } from './Markers';
import { PhaseModel } from './PhaseModel';
import { IsothermalSlice, VerticalSlice } from './Slices';
import { compOfWorld, tOfY } from './world';
import { describeObject } from '../core/phases';
import { inTriangle } from '../core/barycentric';

const PRESETS: Record<ViewPreset, [number, number, number]> = {
  iso: [-0.45, 1.58, 1.85],
  top: [0, 3.1, 0.0001],
  front: [0, 0.08, 3.0],
  side: [2.75, 0.15, -1.15],
};

function CameraRig() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const token = useStore((s) => s.camera.token);
  const preset = useStore((s) => s.camera.preset);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number; tFrom: THREE.Vector3 } | null>(null);
  // 开发调试：允许脚本直接控制相机（演示录制用）
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __r3f: unknown }).__r3f = { camera, controls };
  }, [camera, controls]);
  useEffect(() => {
    if (token === 0) return;
    anim.current = {
      from: camera.position.clone(),
      to: new THREE.Vector3(...PRESETS[preset]),
      t: 0,
      tFrom: controls ? controls.target.clone() : new THREE.Vector3(),
    };
  }, [token]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 0.45);
    const e = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.from, a.to, e);
    if (controls) {
      controls.target.lerpVectors(a.tFrom, new THREE.Vector3(0, 0, 0), e);
      controls.update();
    }
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

function PickRoot({ children }: { children: React.ReactNode }) {
  const setHover = useStore((s) => s.setHover);
  const select = useStore((s) => s.select);
  const setComp = useStore((s) => s.setComp);
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);

  const firstPick = (e: ThreeEvent<MouseEvent>, allowSlices: boolean) =>
    e.intersections.find((h) => {
      const id = h.object.userData?.pick as string | undefined;
      return id && (allowSlices || !id.startsWith('slice:'));
    });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (dragState.active) return;
    // 半透明切片后方的对象优先（切片本身仍可拖动）
    const hit = firstPick(e, false) ?? firstPick(e, true);
    if (!hit) {
      setHover(null);
      return;
    }
    const id = hit.object.userData.pick as string;
    const rect = (e.nativeEvent.target as HTMLElement).getBoundingClientRect();
    const sx = e.nativeEvent.clientX - rect.left;
    const sy = e.nativeEvent.clientY - rect.top;
    const x = compOfWorld(hit.point.x, hit.point.z);
    let T = tOfY(hit.point.y, d.tRange);
    let title = describeObject(id, d)?.title ?? id;
    let extra: string | undefined;
    if (id.startsWith('field:')) {
      T = d.liquidus(x).T;
    } else if (id === 'slice:iso') {
      T = useStore.getState().T;
      title = '等温截面';
      extra = inTriangle(x, 1e-6) ? `相区：${regionName(d.classify(x, T), sym)}（拖动以改变温度）` : undefined;
    } else if (id === 'slice:vert') {
      title = '垂直截面';
      extra = `相区：${regionName(d.classify(x, T), sym)}（拖动以平移截面）`;
    } else if (id.startsWith('pt:')) {
      const p = d.specialPoints.find((q) => q.id === id)!;
      setHover({ id, title, comp: p.comp, T: p.T, sx, sy });
      return;
    }
    setHover({ id, title, comp: x, T, extra, sx, sy });
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4 || performance.now() - dragState.endedAt < 120) return;
    const hit = firstPick(e, false);
    select(hit ? (hit.object.userData.pick as string) : null);
  };

  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hit = firstPick(e, true);
    if (!hit) return;
    const x = compOfWorld(hit.point.x, hit.point.z);
    if (inTriangle(x, 1e-6)) setComp(x);
  };

  return (
    <group onPointerMove={onMove} onPointerOut={() => setHover(null)} onClick={onClick} onDoubleClick={onDouble}>
      {children}
    </group>
  );
}

export function Viewport() {
  const hover = useStore((s) => s.hover);
  const d = useStore((s) => s.diagram);
  const surfaceColor = useStore((s) => s.surfaceColor);
  const cmap = useStore((s) => s.cmap);
  const showLiq = useStore((s) => s.layers.liquidus.visible);
  const setView = useStore((s) => s.setView);
  const sym = d.params.components.map((c) => c.symbol);
  const tr = d.tRange;
  const lo = d.eutectic.T;
  const hi = Math.max(...d.params.components.map((c) => c.Tm));

  const cbTicks: number[] = [];
  for (let t = Math.ceil((tr[0] - 273.15) / 300) * 300; t <= tr[1] - 273.15; t += 300) cbTicks.push(t);

  return (
    <div className="viewport" onPointerLeave={() => useStore.getState().setHover(null)}>
      <Canvas
        camera={{ position: PRESETS.iso, fov: 30, near: 0.05, far: 50 }}
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => useStore.getState().select(null)}
      >
        <color attach="background" args={['#f7f8fa']} />
        <hemisphereLight args={['#ffffff', '#b9bec7', 0.95]} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.15} />
        <directionalLight position={[-3, 2, -2]} intensity={0.35} />
        <PickRoot>
          <PhaseModel />
          <IsothermalSlice />
          <VerticalSlice />
        </PickRoot>
        <Frame />
        <Markers />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={0.9} maxDistance={6} target={[0, 0, 0]} />
        <CameraRig />
      </Canvas>

      <div className="vp-toolbar">
        <button onClick={() => setView('iso')} title="恢复默认视角">重置视角</button>
        <button onClick={() => setView('top')} title="沿温度轴俯视：即液相面投影图">俯视</button>
        <button onClick={() => setView('front')} title="正对 A–B 侧壁">正视</button>
        <button onClick={() => setView('side')} title="侧视">侧视</button>
      </div>

      <div className="vp-hint">左键拖动旋转 · 滚轮缩放 · 右键平移 · 拖动截面移动 · 单击选中 · 双击设定成分</div>

      {showLiq && (
        <div className="colorbar" title={surfaceColor === 'temperature' ? '液相面温度色标' : '按初晶相着色'}>
          {surfaceColor === 'temperature' ? (
            <>
              <div className="cb-title">液相面温度 T / °C</div>
              <div className="cb-bar-h" style={{ background: colormapGradient(cmap, 'to right') }} />
              <div className="cb-ticks-h">
                {cbTicks.map((t) => (
                  <span key={t} style={{ left: `${((t + 273.15 - tr[0]) / (tr[1] - tr[0])) * 100}%` }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="cb-note">
                液相面范围 {formatC(lo, 0)} – {formatC(hi, 0)}
              </div>
            </>
          ) : (
            <div className="cb-legend">
              {sym.map((s, i) => (
                <div key={s}>
                  <i style={{ background: ['#0072BD', '#D95319', '#3C8D2F'][i] }} /> {s} 初晶面
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hover && (
        <div className="tooltip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          <div className="tt-title">{hover.title}</div>
          {hover.comp && (
            <div className="tt-row mono">
              {hover.comp.map((v, n) => (
                <span key={n}>
                  x({sym[n]}) {(Math.max(0, v) * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          )}
          {hover.T !== undefined && <div className="tt-row mono">T = {formatC(hover.T)}</div>}
          {hover.extra && <div className="tt-row">{hover.extra}</div>}
        </div>
      )}
    </div>
  );
}
