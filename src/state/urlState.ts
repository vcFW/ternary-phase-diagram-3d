import { getPreset, PRESETS } from '../core/presets';
import type { Comp } from '../core/types';
import { defaultOverride, type ParamOverride } from './store';

/**
 * 共享物理状态 ⇄ URL query 的序列化（纯函数，便于测试）。
 *   p  体系预设 id
 *   x  总成分 x_A,x_B,x_C
 *   T  温度 / K
 *   o  参数覆盖：stab,omega,dTA,dTB,dTC（缺省时省略）
 */
export interface PhysState {
  presetId: string;
  x0: Comp;
  T: number;
  override: ParamOverride;
}

export function encodeState(s: PhysState, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  q.set('p', s.presetId);
  q.set('x', s.x0.map((v) => v.toFixed(4)).join(','));
  q.set('T', s.T.toFixed(2));
  const o = s.override;
  const def = defaultOverride();
  if (o.stab !== def.stab || o.omega !== def.omega || o.dTm.some((v, i) => v !== def.dTm[i]))
    q.set('o', [o.stab ?? '', o.omega, ...o.dTm].join(','));
  else q.delete('o');
  return q;
}

export function decodeState(q: URLSearchParams): Partial<PhysState> {
  const out: Partial<PhysState> = {};
  const p = q.get('p');
  if (p && PRESETS.some((pr) => pr.id === p)) out.presetId = getPreset(p).id;
  const x = q.get('x');
  if (x) {
    const v = x.split(',').map(Number);
    if (v.length === 3 && v.every((u) => Number.isFinite(u) && u >= 0)) {
      const s = v[0] + v[1] + v[2];
      if (s > 0) out.x0 = [v[0] / s, v[1] / s, v[2] / s];
    }
  }
  const T = Number(q.get('T'));
  if (q.get('T') && Number.isFinite(T) && T > 0) out.T = T;
  const o = q.get('o');
  if (o) {
    const v = o.split(',');
    if (v.length === 5) {
      const n = v.map((u) => (u === '' ? null : Number(u)));
      if (n.slice(1).every((u) => u !== null && Number.isFinite(u)))
        out.override = { stab: n[0] !== null && Number.isFinite(n[0]) ? (n[0] as number) : null, omega: n[1] as number, dTm: [n[2] as number, n[3] as number, n[4] as number] };
    }
  }
  return out;
}
