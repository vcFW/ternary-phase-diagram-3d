import * as THREE from 'three';
import { CENTROID_V, fromXY, toXY } from '../core/barycentric';
import type { Comp } from '../core/types';

/**
 * 三维世界坐标映射：
 *   X = u − 1/2，Z = −(v − √3/6)  （成分三角形质心位于原点，C 顶点朝后）
 *   Y = (T − T_min)/(T_max − T_min)·H − H/2
 */
export const H = 0.72;

export interface WorldMap {
  tRange: [number, number];
}

export function yOfT(T: number, tRange: [number, number]): number {
  return ((T - tRange[0]) / (tRange[1] - tRange[0])) * H - H / 2;
}

export function tOfY(y: number, tRange: [number, number]): number {
  return tRange[0] + ((y + H / 2) / H) * (tRange[1] - tRange[0]);
}

export function toWorld(x: Comp, T: number, tRange: [number, number]): [number, number, number] {
  const [u, v] = toXY(x);
  return [u - 0.5, yOfT(T, tRange), -(v - CENTROID_V)];
}

export function toWorldV(x: Comp, T: number, tRange: [number, number]): THREE.Vector3 {
  const p = toWorld(x, T, tRange);
  return new THREE.Vector3(p[0], p[1], p[2]);
}

export function compOfWorld(X: number, Z: number): Comp {
  return fromXY(X + 0.5, -Z + CENTROID_V);
}
