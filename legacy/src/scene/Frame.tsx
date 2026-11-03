import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { lerpComp, VERTICES } from '../core/barycentric';
import type { Comp, CompIndex } from '../core/types';
import { useStore } from '../state/store';
import { toWorld } from './world';

/**
 * 坐标框架（参照 MATLAB 三维坐标区的 box/grid 规则）：
 *   - 侧壁网格只绘制在背向相机的壁面上，避免遮挡模型；
 *   - 成分刻度只标注在朝向相机的底边上；俯视时三边全部标注；
 *   - 温度轴自动放在屏幕最左侧的竖直棱上。
 * 相机转动时以上可见性实时更新。
 */

/** 底边：[起点, 终点, 该边标注的组元] —— A→B 标 x_B，B→C 标 x_C，C→A 标 x_A */
const EDGES: [CompIndex, CompIndex, CompIndex][] = [
  [0, 1, 1],
  [1, 2, 2],
  [2, 0, 0],
];

interface FrameView {
  facing: [boolean, boolean, boolean];
  axisV: CompIndex;
  topView: boolean;
}

export function Frame() {
  const d = useStore((s) => s.diagram);
  const visible = useStore((s) => s.layers.frame.visible);
  const tr = d.tRange;
  const sym = d.params.components.map((c) => c.symbol);
  const [view, setView] = useState<FrameView>({ facing: [true, false, false], axisV: 0, topView: false });

  const geo = useMemo(() => {
    const base = [...VERTICES, VERTICES[0]].map((v) => toWorld(v, tr[0], tr));
    const top = [...VERTICES, VERTICES[0]].map((v) => toWorld(v, tr[1], tr));
    const verticals = VERTICES.map((v) => [toWorld(v, tr[0], tr), toWorld(v, tr[1], tr)] as [number, number, number][]);
    const grid: [number, number, number][] = [];
    for (const k of [0, 1, 2] as CompIndex[]) {
      for (let n = 1; n < 10; n++) {
        const v = n / 10;
        const a: Comp = [0, 0, 0];
        const b: Comp = [0, 0, 0];
        a[k] = v;
        a[(k + 1) % 3] = 1 - v;
        b[k] = v;
        b[(k + 2) % 3] = 1 - v;
        grid.push(toWorld(a, tr[0], tr), toWorld(b, tr[0], tr));
      }
    }
    const ticks: number[] = [];
    for (let t = Math.ceil((tr[0] - 273.15) / 100) * 100; t <= tr[1] - 273.15 + 1e-6; t += 100) ticks.push(t + 273.15);
    // 每面侧壁：水平温度网格 + 竖直成分网格
    const walls = EDGES.map(([a, b]) => {
      const seg: [number, number, number][] = [];
      for (const T of ticks) seg.push(toWorld(VERTICES[a], T, tr), toWorld(VERTICES[b], T, tr));
      for (let n = 1; n < 10; n++) {
        const x = lerpComp(VERTICES[a], VERTICES[b], n / 10);
        seg.push(toWorld(x, tr[0], tr), toWorld(x, tr[1], tr));
      }
      const mid = toWorld(lerpComp(VERTICES[a], VERTICES[b], 0.5), tr[0], tr);
      const len = Math.hypot(mid[0], mid[2]);
      return { seg, normal: new THREE.Vector3(mid[0] / len, 0, mid[2] / len), mid: new THREE.Vector3(mid[0], 0, mid[2]) };
    });
    return { base, top, verticals, grid, ticks, walls };
  }, [d]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const facing = geo.walls.map((w) => tmp.copy(camera.position).sub(w.mid).setY(0).dot(w.normal) > 0) as [boolean, boolean, boolean];
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const topView = dir.y < -0.8;
    let axisV: CompIndex = 0;
    let minX = Infinity;
    VERTICES.forEach((v, n) => {
      const p = toWorld(v, (tr[0] + tr[1]) / 2, tr);
      const s = tmp.set(p[0], p[1], p[2]).project(camera);
      if (s.x < minX) {
        minX = s.x;
        axisV = n as CompIndex;
      }
    });
    if (
      facing.some((f, n) => f !== view.facing[n]) ||
      topView !== view.topView ||
      axisV !== view.axisV
    ) {
      setView({ facing, topView, axisV });
    }
  });

  if (!visible) return null;

  const outward = (a: CompIndex, b: CompIndex, dist: number): [number, number] => {
    const m = toWorld(lerpComp(VERTICES[a], VERTICES[b], 0.5), tr[0], tr);
    const len = Math.hypot(m[0], m[2]);
    return [(m[0] / len) * dist, (m[2] / len) * dist];
  };
  // 温度轴刻度朝向：远离棱柱中心
  const av = toWorld(VERTICES[view.axisV], tr[0], tr);
  const avLen = Math.hypot(av[0], av[2]);
  const ax: [number, number] = [av[0] / avLen, av[2] / avLen];

  return (
    <group>
      <Line points={geo.base} color="#202020" lineWidth={1.4} />
      <Line points={geo.top} color="#b4b8be" lineWidth={1} dashed dashSize={0.012} gapSize={0.008} />
      {geo.verticals.map((p, n) => (
        <Line key={n} points={p} color={n === view.axisV ? '#202020' : '#9da3ab'} lineWidth={n === view.axisV ? 1.4 : 1} />
      ))}
      <Line points={geo.grid} segments color="#d0d4da" lineWidth={0.8} />
      {geo.walls.map((w, n) =>
        view.facing[n] && !view.topView ? null : <Line key={n} points={w.seg} segments color="#dfe2e6" lineWidth={0.8} />,
      )}

      {/* 温度轴 */}
      {geo.ticks.map((T) => {
        const p = toWorld(VERTICES[view.axisV], T, tr);
        return (
          <group key={T}>
            <Line points={[p, [p[0] + ax[0] * 0.02, p[1], p[2] + ax[1] * 0.02]]} color="#202020" lineWidth={1} />
            <Html position={[p[0] + ax[0] * 0.055, p[1], p[2] + ax[1] * 0.055]} center zIndexRange={[20, 0]} className="lbl lbl-tick">
              {Math.round(T - 273.15)}
            </Html>
          </group>
        );
      })}
      <Html
        position={[av[0] + ax[0] * 0.13, toWorld(VERTICES[0], (tr[0] + tr[1]) / 2, tr)[1], av[2] + ax[1] * 0.13]}
        center
        zIndexRange={[20, 0]}
        className="lbl lbl-axis lbl-vert"
      >
        温度 T / °C
      </Html>

      {/* 成分刻度：仅标注朝向相机的底边 */}
      {EDGES.map(([a, b, comp], e) => {
        if (!view.facing[e] && !view.topView) return null;
        const o = outward(a, b, 0.04);
        const items = [];
        for (let n = 1; n < 10; n++) {
          const x = lerpComp(VERTICES[a], VERTICES[b], n / 10);
          const p = toWorld(x, tr[0], tr);
          items.push(
            <Html key={n} position={[p[0] + o[0], p[1], p[2] + o[1]]} center zIndexRange={[20, 0]} className="lbl lbl-tick">
              {x[comp].toFixed(1)}
            </Html>,
          );
        }
        const pm = toWorld(lerpComp(VERTICES[a], VERTICES[b], 0.5), tr[0], tr);
        const oa = outward(a, b, 0.1);
        return (
          <group key={e}>
            {items}
            <Html position={[pm[0] + oa[0], pm[1], pm[2] + oa[1]]} center zIndexRange={[20, 0]} className="lbl lbl-axis">
              x({sym[comp]})
            </Html>
          </group>
        );
      })}

      {/* 组元标注置于棱柱顶角，避免被曲面遮挡时仍浮在模型上 */}
      {VERTICES.map((v, n) => {
        const p = toWorld(v, tr[1], tr);
        const len = Math.hypot(p[0], p[2]);
        return (
          <Html key={n} position={[p[0] + (p[0] / len) * 0.035, p[1] + 0.035, p[2] + (p[2] / len) * 0.035]} center zIndexRange={[20, 0]} className="lbl lbl-vertex">
            {sym[n]}
          </Html>
        );
      })}
    </group>
  );
}
