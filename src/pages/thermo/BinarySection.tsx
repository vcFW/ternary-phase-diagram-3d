import { useMemo, useState } from 'react';
import { cel, solidColor, toC, toK } from '../../core/colors';
import { binaryEquilibrium, edgeCurves, idealLens, ssCurves, SS_DEFAULT, type Curve1, type SSModel } from '../../math/binary';
import { fmtNum } from '../../math/linalg';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { XYPlot, type Series } from '../../viz/XYPlot';
import { Derivation, Eq, M, Panel, Prov } from '../../viz/MathView';
import { Segmented } from '../../ui/controls';
import { LocalParam } from '../../ui/LocalParam';
import { COLOR, SERIES } from '../../ui/tokens';

type Src = 'edge' | 'ss';
const EDGES: [0 | 1 | 2, 0 | 1 | 2][] = [
  [0, 1],
  [1, 2],
  [0, 2],
];

/**
 * 二元公切线：平衡 = 所有相自由能曲线 / 点的下凸包。
 * 数据源一：当前三元模型的某条二元边（液相曲线 + 化学计量固相点 / 固溶体曲线）；
 * 数据源二：明确标注的二元固溶体演示模型（两条正规溶液曲线，理想时有闭式解对照）。
 */
export function BinarySection() {
  const d = useStore((s) => s.diagram);
  const Tg = useStore((s) => s.T);
  const setTglobal = useStore((s) => s.setT);
  const [src, setSrc] = useState<Src>('edge');
  const [edge, setEdge] = useState(0);
  const [T, setTl] = useState(Tg);
  const [ss, setSs] = useState<SSModel>(SS_DEFAULT);
  const sym = d.params.components.map((c) => c.symbol);
  const [i, j] = EDGES[edge];
  const curves: Curve1[] = useMemo(() => (src === 'edge' ? edgeCurves(d.th, i, j, T) : ssCurves(ss, T)), [src, d, i, j, T, ss]);
  const be = useMemo(() => binaryEquilibrium(curves, T), [curves, T]);
  const lens = src === 'ss' && ss.omegaL === 0 && ss.omegaS === 0 ? idealLens(ss, T) : null;
  const left = src === 'edge' ? sym[i] : '1';
  const right = src === 'edge' ? sym[j] : '2';
  // G 曲线
  const series: Series[] = [];
  const pts: { x: number; y: number; color?: string; r?: number; label?: string }[] = [];
  for (const c of curves) {
    if (c.G) {
      const p: [number, number][] = [];
      for (let k = 1; k < 400; k++) {
        const x = k / 400;
        p.push([x, c.G(x) / 1000]);
      }
      series.push({ id: c.id, pts: p, color: c.id === 'L' ? COLOR.phase.liquid : COLOR.component[0], label: c.id === 'L' ? 'G_L(x)' : `G_${c.id}(x)` });
    } else if (c.point) {
      const s = d.solids.find((q) => q.id === c.id);
      pts.push({ x: c.point.x, y: c.point.G / 1000, color: s ? solidColor(s.index) : COLOR.ink, r: 4.5, label: c.id });
    }
  }
  // 公切线
  for (const [k, t] of be.tangents.entries()) {
    const g = (x: number) => (t.mu[0] * (1 - x) + t.mu[1] * x) / 1000;
    series.push({ id: `t${k}`, pts: [[0, g(0)], [1, g(1)]], color: COLOR.ink, width: 1, dash: '5 3' });
    pts.push({ x: 0, y: g(0), color: COLOR.ink, r: 3 }, { x: 1, y: g(1), color: COLOR.ink, r: 3 });
  }
  const ys = series.flatMap((s) => s.pts.map((p) => p[1])).concat(pts.map((p) => p.y));
  const ylo = Math.min(...ys);
  const yhi = Math.max(...curves.filter((c) => c.G).map((c) => Math.max(c.G!(0.02), c.G!(0.98)) / 1000), ...pts.map((p) => p.y));
  // T–x 相图（逐温度求公切线）
  const range = src === 'edge' ? d.tRange() : { Tmin: Math.min(...ss.Tm) - 450, Tmax: Math.max(...ss.Tm) + 60 };
  const diag = useMemo(() => {
    const out: { T: number; xs: number[]; kind: string }[] = [];
    const n = 110;
    for (let k = 0; k <= n; k++) {
      const TT = range.Tmax - ((range.Tmax - range.Tmin) * k) / n;
      const cs = src === 'edge' ? edgeCurves(d.th, i, j, TT) : ssCurves(ss, TT);
      for (const t of binaryEquilibrium(cs, TT).tangents) out.push({ T: TT, xs: [t.xa, t.xb], kind: `${t.left}|${t.right}` });
    }
    return out;
  }, [src, d, i, j, ss, range.Tmin, range.Tmax]);
  const pd: Series[] = [];
  const kinds = Array.from(new Set(diag.map((p) => p.kind)));
  const palette: readonly string[] = SERIES;
  kinds.forEach((kd, ki) => {
    const rows = diag.filter((p) => p.kind === kd);
    const [la, lb] = kd.split('|');
    // 只连连续变化的端点（曲线–曲线 / 曲线–点）
    if (la === 'L' || la === 'α') pd.push({ id: `${kd}a`, pts: rows.map((r) => [r.xs[0], toC(r.T)] as [number, number]), color: palette[ki % 7], width: 1.6, label: `${kd.replace('|', ' / ')}` });
    if (lb === 'L' || lb === 'α') pd.push({ id: `${kd}b`, pts: rows.map((r) => [r.xs[1], toC(r.T)] as [number, number]), color: palette[ki % 7], width: 1.6 });
  });
  return (
    <>
      <PageTitle title="二元公切线" desc="稳定的相组合 = 自由能曲线（与点）的下凸包；跨越两相的直线段就是公切线，其截距即化学势。" />
      <div className="cols c21">
        <div className="stack">
          <Panel
            title={`G(x) 于 T = ${cel(T, 1)}`}
            prov={src === 'edge' ? 'model' : 'demo'}
            right={
              <div className="row">
                <Segmented size="sm" value={src} onChange={setSrc} options={[{ value: 'edge', label: '当前体系的二元边' }, { value: 'ss', label: '固溶体演示模型' }]} />
                {src === 'edge' && <Segmented size="sm" value={edge} onChange={setEdge} options={EDGES.map(([a, b], k) => ({ value: k, label: `${sym[a]}–${sym[b]}` }))} />}
              </div>
            }
          >
            <XYPlot
              height={300}
              series={series}
              points={pts}
              xlim={[0, 1]}
              ylim={[ylo - 0.4, Math.max(yhi, ylo + 1) + 0.3]}
              xlabel={`x_${right}（${left}–${right} 二元）`}
              ylabel="G / (kJ·mol⁻¹)，以纯固相为基准"
              vlines={be.tangents.flatMap((t) => [{ x: t.xa, color: COLOR.muted }, { x: t.xb, color: COLOR.muted }])}
            />
            <LocalParam label="T" labelWidth={30} value={toC(T)} min={Math.ceil(toC(range.Tmin))} max={Math.floor(toC(range.Tmax))} step={1} digits={0} unit="°C" onChange={(v) => setTl(toK(v))} global={toC(Tg)} onSetGlobal={(v) => setTglobal(toK(v))} />
            {src === 'ss' && (
              <div className="grid2">
                <LocalParam label="Ω_L" labelWidth={34} value={ss.omegaL / 1000} min={-10} max={20} step={0.5} digits={1} unit="kJ" onChange={(v) => setSs({ ...ss, omegaL: v * 1000 })} />
                <LocalParam label="Ω_α" labelWidth={34} value={ss.omegaS / 1000} min={-10} max={30} step={0.5} digits={1} unit="kJ" onChange={(v) => setSs({ ...ss, omegaS: v * 1000 })} />
              </div>
            )}
            <table className="grid">
              <thead>
                <tr>
                  <th>两相区</th>
                  <th>切点成分</th>
                  <th>μ_{left}（x=0 截距）</th>
                  <th>μ_{right}（x=1 截距）</th>
                  <th>精化残差</th>
                </tr>
              </thead>
              <tbody>
                {be.tangents.map((t, k) => (
                  <tr key={k}>
                    <td>{t.left} + {t.right}</td>
                    <td className="num">{fmtNum(t.xa, 5)} / {fmtNum(t.xb, 5)}</td>
                    <td className="num">{fmtNum(t.mu[0], 2)}</td>
                    <td className="num">{fmtNum(t.mu[1], 2)}</td>
                    <td className="num">{t.residual.toExponential(1)}</td>
                  </tr>
                ))}
                {!be.tangents.length && (
                  <tr>
                    <td colSpan={5}>该温度下下凸包没有跨相线段：单相稳定（或全为固相点之间的连线）。</td>
                  </tr>
                )}
              </tbody>
            </table>
            {lens && (
              <div className="callout">
                <Prov k="math" /> 理想匀晶系闭式解：x_α = {fmtNum(lens.xS, 6)}，x_L = {fmtNum(lens.xL, 6)}
                {be.tangents[0] && <>；数值公切线：{fmtNum(be.tangents[0].xa, 6)} / {fmtNum(be.tangents[0].xb, 6)}，差 {Math.max(Math.abs(be.tangents[0].xa - lens.xS), Math.abs(be.tangents[0].xb - lens.xL)).toExponential(1)}</>}
              </div>
            )}
          </Panel>
          <Panel title="由公切线逐温度构造的 T–x 相图" prov={src === 'edge' ? 'model' : 'demo'} sub="每条曲线 = 公切点随温度的轨迹">
            <XYPlot height={250} series={pd} xlim={[0, 1]} xlabel={`x_${right}`} ylabel="T / °C" hlines={[{ y: toC(T), color: COLOR.stateX0, label: '当前 T' }]} onPick={(_x, y) => setTl(toK(y))} />
            <p className="note">点击图中任意高度可改变左侧 G(x) 图的温度。{src === 'ss' && 'Ω_α 足够大时固溶体曲线出现双峰（溶解度间隙），共晶型相图由此"长出来"。'}</p>
          </Panel>
        </div>
        <div className="stack">
          <Derivation
            title="推导：公切线 ⇔ 化学势相等"
            steps={[
              { kind: 'known', body: <>各相的摩尔吉布斯能 G_φ(x, T)；化学计量相为单点 (x_s, G_s)，固溶体为曲线。总成分 x₀。</> },
              { kind: 'govern', body: <Eq>min Σ f_φ G_φ(x_φ)　s.t.　Σ f_φ x_φ = x₀,　Σ f_φ = 1,　f_φ ≥ 0</Eq> },
              { kind: 'op', title: '几何', body: <>目标值是"x₀ 处、由若干曲线点的凸组合所能达到的最低 G" —— 正是所有曲线点集的下凸包在 x₀ 处的高度。</> },
              { kind: 'op', title: '拉格朗日条件', body: <>对 x_α、x_β 求导：<M>G_α′(x_α) = G_β′(x_β) = (G_β − G_α)/(x_β − x_α)</M> —— 同一条直线与两曲线相切。</> },
              { kind: 'mid', body: <>切线在 x = 0、1 处的截距 μ₁ = G − xG′，μ₂ = G + (1 − x)G′ 就是偏摩尔吉布斯能（化学势）。</> },
              { kind: 'result', body: <>公切线 ⇔ μ₁^α = μ₁^β 且 μ₂^α = μ₂^β。两相的成分由切点给出，数量由杠杆规则给出。</> },
              { kind: 'phys', body: <>凸包"填平"了曲线上所有向上凸的部分：分成两相比保持均匀单相更低 —— 相分离的热力学驱动力。</> },
              { kind: 'valid', body: <>恒温恒压、封闭体系、忽略界面能；G 函数（模型）必须正确 —— 平台中所有 G 都是示意模型。</> },
            ]}
          />
          <Panel title="数值方法" prov="math">
            <ul className="plain">
              <li>每条曲线取 600 个点，Andrew 单调链求下凸包；跨越不同相（或同一曲线上的大间隔）的边即候选公切线。</li>
              <li>曲线–曲线：牛顿法解 (μ₁^α − μ₁^β, μ₂^α − μ₂^β) = 0；曲线–点：解切线过定点方程。</li>
              <li>验证：理想匀晶系与闭式解对比（验证算例 7），误差 ~10⁻¹⁵。</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
