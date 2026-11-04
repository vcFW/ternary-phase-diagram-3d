import { useMemo, useState } from 'react';
import { toXY } from '../../core/barycentric';
import { cel, toC } from '../../core/colors';
import { fmtNum } from '../../math/linalg';
import { frameAt, liquidusGradient, parametrize } from '../../math/spaces';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Arrow, Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { XYPlot } from '../../viz/XYPlot';
import { Derivation, Eq, KV, M, MatrixView, Panel } from '../../viz/MathView';
import { Segmented } from '../../ui/controls';
import { LocalParam } from '../../ui/LocalParam';
import { COLOR } from '../../ui/tokens';

/**
 * 等温线 = 液相面 T = T_liq(x) 的等值集；界线 = 三维空间曲线 (x(s), T(s)) 的投影。
 * 本节把"等温线疏密""降温箭头"还原为梯度与切向量，并演示液相析晶方向 ≠ 最速下降方向。
 */
export function GeometrySection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const [step, setStep] = useState(25);
  const [ci, setCi] = useState(0);
  const [sFrac, setSFrac] = useState(0.5);
  const sym = d.params.components.map((c) => c.symbol);
  const g = liquidusGradient(d, x0);
  const gn = Math.hypot(g.g[0], g.g[1]);
  const s = d.solids[g.si];
  // 初晶析出时液相移动方向：背离固相点（质量守恒）
  const P0 = toXY(x0);
  const PS = toXY(s.n);
  const away = [P0[0] - PS[0], P0[1] - PS[1]];
  const an = Math.hypot(away[0], away[1]) || 1;
  const cosang = gn > 0 ? (-(g.g[0] * away[0] + g.g[1] * away[1]) / (gn * an)) : NaN;
  const ang = (Math.acos(Math.max(-1, Math.min(1, cosang))) * 180) / Math.PI;
  const curves = d.topo.curves;
  const cv = curves[Math.min(ci, curves.length - 1)];
  const cp = useMemo(() => (cv ? parametrize(cv) : null), [cv]);
  const fr = cp ? frameAt(cp, sFrac * cp.length) : null;
  const Tseries = cp ? cp.s.map((v, k) => [v, toC(cp.T[k])] as [number, number]) : [];
  return (
    <>
      <PageTitle title="等温线与界线的几何" desc="等温线是等值集，箭头是切向量在温度方向上的符号；液相路径由守恒决定，而非梯度。" />
      <div className="cols c2">
        <div className="stack">
          <Panel
            title="液相面梯度、等温线切向与析晶方向"
            prov="model"
            right={<Segmented size="sm" value={step} onChange={setStep} options={[10, 25, 50].map((v) => ({ value: v, label: `${v} K` }))} />}
          >
            <div className="plot-box tall">
              <TernaryPlot d={d} background="fields" isoStep={step} onPick={(x) => setX0(x)}>
                {(m) => {
                  const p = m.px(x0);
                  const L = 70;
                  // 笛卡尔 (u,v) → 屏幕：y 轴反向
                  const gd: [number, number] = gn > 0 ? [-g.g[0] / gn, g.g[1] / gn] : [0, 0];
                  const tg: [number, number] = [gd[1], -gd[0]];
                  const aw: [number, number] = [away[0] / an, -away[1] / an];
                  const ps = m.px(s.n);
                  return (
                    <>
                      <line x1={ps[0]} y1={ps[1]} x2={p[0] + aw[0] * 1.6 * L} y2={p[1] + aw[1] * 1.6 * L} className="lnk dash" />
                      <Arrow p={p} q={[p[0] + gd[0] * L, p[1] + gd[1] * L]} cls="grad" />
                      <Arrow p={[p[0] - tg[0] * L * 0.6, p[1] - tg[1] * L * 0.6]} q={[p[0] + tg[0] * L * 0.6, p[1] + tg[1] * L * 0.6]} cls="dim thin" head={5} />
                      <Arrow p={p} q={[p[0] + aw[0] * L, p[1] + aw[1] * L]} cls="vec" />
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x)} />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <div className="legend-inline">
              <span><i style={{ background: '#d95319' }} />−∇T_liq（最速降温方向）</span>
              <span><i style={{ background: '#7b8490' }} />等温线切向（⊥ ∇T）</span>
              <span><i style={{ background: COLOR.accent }} />初晶析出时液相移动方向（背离 {s.label}）</span>
            </div>
            <KV
              rows={[
                ['初晶相 / 液相线', <>{s.label}，{cel(g.T, 1)}</>],
                ['∇T_liq（笛卡尔）', <span className="mono">({fmtNum(g.g[0], 1)}, {fmtNum(g.g[1], 1)}) K / 单位边长</span>],
                ['|∇T|，等温线间距 ΔT/|∇T|', <span className="mono">{fmtNum(gn, 1)} K，{gn > 0 ? fmtNum(step / gn, 4) : '∞'}（{step} K 间隔）</span>],
                ['析晶方向与 −∇T 的夹角', <span className="mono">{Number.isFinite(ang) ? `${ang.toFixed(1)}°` : '—'}</span>],
              ]}
            />
            <div className="callout warn">
              两者一般不重合（夹角 {Number.isFinite(ang) ? ang.toFixed(0) : '—'}°）：液相不是"顺着最陡的坡往下流"。它的方向由质量守恒
              <M> x₀ = f_L x_L + f_s x_s </M> 唯一确定 —— x_L 必须在 x_s→x₀ 射线上背离 x_s；温度只决定它沿这条射线走多远。
            </div>
          </Panel>
          <Derivation
            title="推导：等温线的几何"
            steps={[
              { kind: 'known', body: <>液相面 T = T_liq(u, v)（本模型中 T_liq = max_s T_s(x) 有闭式解）。</> },
              { kind: 'govern', body: <>等温线 Γ_T₀ = {'{'}(u,v) : T_liq(u,v) = T₀{'}'} = 液相面 ∩ 平面 T = T₀ 的投影。</> },
              { kind: 'op', body: <>沿 Γ 求导：<M>∇T·(du, dv) = 0</M> ⇒ 等温线切向 ⊥ ∇T。</> },
              { kind: 'mid', body: <>相邻等温线（差 ΔT）的间距 ≈ ΔT / |∇T|：线越密，液相面越陡。</> },
              { kind: 'result', body: <>二维图中的"疏密"就是 |∇T| 的离散编码；方向信息由等温线的走向给出。</> },
              { kind: 'valid', body: <>只在同一初晶面内成立；跨越界线时 T_liq 连续但不可导（两张曲面取最大），等温线出现折角。</> },
            ]}
          />
        </div>
        <div className="stack">
          <Panel
            title="界线：三维空间曲线与它的投影"
            prov="model"
            right={
              <select value={Math.min(ci, curves.length - 1)} onChange={(e) => setCi(Number(e.target.value))}>
                {curves.map((c, k) => (
                  <option key={c.id} value={k}>
                    {d.solids[c.a].label}/{d.solids[c.b].label} 界线
                  </option>
                ))}
              </select>
            }
          >
            {cp && fr && (
              <>
                <div className="plot-box short">
                  <TernaryPlot d={d} background="fields" minHeight={240}>
                    {(m) => {
                      const p = m.px(fr.x);
                      const L = 60;
                      const t: [number, number] = [fr.tCool[0], -fr.tCool[1]];
                      return (
                        <>
                          <polyline points={cv.pts.map((x) => m.px(x).join(',')).join(' ')} fill="none" stroke="#c00000" strokeWidth={2.6} opacity={0.5} />
                          <Arrow p={p} q={[p[0] + t[0] * L, p[1] + t[1] * L]} cls="tan" />
                          <circle cx={p[0]} cy={p[1]} r={4} fill="#7e2f8e" />
                        </>
                      );
                    }}
                  </TernaryPlot>
                </div>
                <LocalParam label="弧长 s / L" labelWidth={80} value={sFrac} min={0} max={1} step={0.005} digits={3} onChange={setSFrac} />
                <XYPlot
                  height={170}
                  series={[{ id: 'T', pts: Tseries, color: '#1d2229', label: 'T(s)：界线温度（三维曲线的高度）' }]}
                  xlabel="弧长 s（单位边长）"
                  ylabel="T / °C"
                  vlines={[{ x: fr.s, color: '#7e2f8e' }]}
                  points={[{ x: fr.s, y: toC(fr.T), color: '#7e2f8e' }]}
                  onPick={(x) => setSFrac(Math.max(0, Math.min(1, x / cp.length)))}
                />
                <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
                  <MatrixView name="dγ/ds" M={[[fr.t[0]], [fr.t[1]], [fr.dTds]]} rowLabels={['du', 'dv', 'dT']} digits={4} />
                  <MatrixView name="P·dγ/ds" M={[[fr.t[0]], [fr.t[1]]]} rowLabels={['du', 'dv']} digits={4} />
                </div>
                <p>
                  三维切向量 γ′(s) = (u′, v′, T′) 经过投影后变为 P·γ′ = (u′, v′)：<b>线性映射的导数就是它自身</b>，所以投影曲线的切向就是三维切向去掉温度分量。
                  被丢掉的 T′ = {fmtNum(fr.dTds, 2)} K/单位弧长；二维图只保留它的符号 —— 箭头指向 {fr.dTds <= 0 ? 's 增大' : 's 减小'} 的方向（降温）。
                </p>
                <p className="note">
                  曲线由栅格提取后，用局部二次最小二乘求导（窗口 ±{(Math.max(0.012, cp.length * 0.04)).toFixed(3)}）。端点附近导数精度较低。
                </p>
              </>
            )}
            {!cp && <p className="dim">该体系没有界线。</p>}
          </Panel>
          <Panel title="小结：二维投影上的「规则」来自哪里" prov="math">
            <ul className="plain">
              <li>等温线：等值集 ⇒ 切向 ⊥ 梯度、疏密 ∝ |∇T|。</li>
              <li>界线箭头：sign(dT/ds) —— 三维切向量被 P 丢掉的那一个分量的符号。</li>
              <li>直线规则 / 杠杆规则：线性映射保持共线与线段比，所以可以在投影图上量。</li>
              <li>
                温度不能直接量：被 P 映到零 —— 必须借助等温线、不变点标注或热力学模型。
              </li>
            </ul>
            <Eq>γ(s) = (x(s), T(s)) ∈ R³　⟶　P∘γ(s) = x(s) ∈ R²</Eq>
            <p className="dim small">提示：上图组元记号 {sym.join('、')}；颜色块表示初晶区（{d.solids.map((q) => q.label).join('、')}）。</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
