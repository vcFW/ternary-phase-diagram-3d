import { useMemo, useState } from 'react';
import { colormapCss } from '../../core/colormap';
import { cel, solidColor } from '../../core/colors';
import type { Comp } from '../../core/types';
import { R } from '../../core/thermo';
import { planeAt, tpdField } from '../../math/gibbsMin';
import { fmtNum } from '../../math/linalg';
import { gibbsMinAt } from '../../state/derived';
import { useStore } from '../../state/store';
import { Axo3D, type Surface } from '../../viz/Axo3D';
import { PageTitle } from '../../viz/PageLayout';
import { cm255, fieldImage, Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { Derivation, Eq, KV, M, Panel } from '../../viz/MathView';
import { Segmented } from '../../ui/controls';
import { COLOR } from '../../ui/tokens';

/**
 * 三元公切面：吉布斯能最小化写成线性规划，其对偶变量就是化学势 μ（公切面）。
 * 本节使用独立于 PhaseDiagram.equilibrium 的求解器（列生成），并与之逐项对照。
 */
export function TernaryGSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  const setX0 = useStore((s) => s.setX0);
  const gm = gibbsMinAt(d, x0, T);
  const [mode, setMode] = useState<'raw' | 'tpd'>('tpd');
  const th = d.th;
  const mu = gm.mu;
  const RT = R * T;
  const img = useMemo(
    () =>
      fieldImage((x) => {
        // 所有连续相（液相、固溶体）中离切面最近者
        let v = tpdField(th, mu, T, x);
        for (const s of th.solids) if (s.sol) v = Math.min(v, tpdField(th, mu, T, x, s.index));
        if (!Number.isFinite(v)) return null;
        if (v < -1e-3) return [192, 0, 0];
        return cm255(Math.min(1, Math.sqrt(Math.max(0, v) / (1.5 * RT))));
      }, 170),
    [th, mu, T, RT],
  );
  // 原始 G 的范围
  const corners = [th.Gliq([1, 0, 0], T), th.Gliq([0, 1, 0], T), th.Gliq([0, 0, 1], T), th.Gliq([1 / 3, 1 / 3, 1 / 3], T), ...d.solids.map((s) => th.Gphase(s.index, s.n, T)), ...mu.filter(Number.isFinite)];
  const zlo0 = Math.min(...corners) - 300;
  const zhi0 = Math.max(...corners) + 300;
  const surf: Surface[] = useMemo(() => {
    const solSurf: Surface[] = th.solids
      .filter((s) => s.sol)
      .map((s) => ({
        N: 24,
        f: (x: Comp) => (mode === 'tpd' ? Math.min(1.6 * RT, tpdField(th, mu, T, x, s.index)) : Math.min(zhi0, th.Gphase(s.index, x, T))) / 1000,
        color: () => solidColor(s.index),
        opacity: 0.45,
      }));
    if (mode === 'tpd')
      return [
        { N: 30, f: (x) => Math.min(1.6 * RT, tpdField(th, mu, T, x)) / 1000, color: (_x, v) => colormapCss('parula', Math.min(1, Math.sqrt(Math.max(0, v * 1000) / (1.5 * RT)))), opacity: 0.9 },
        ...solSurf,
        { N: 2, f: () => 0, color: () => COLOR.faint, opacity: 0.25, stroke: false },
      ];
    return [
      { N: 30, f: (x) => th.Gliq(x, T) / 1000, color: (_x, v) => colormapCss('parula', 0.15 + 0.7 * ((v * 1000 - zlo0) / (zhi0 - zlo0 || 1))), opacity: 0.9 },
      ...solSurf,
      { N: 2, f: (x) => planeAt(mu, x) / 1000, color: () => COLOR.faint, opacity: 0.35, stroke: false },
    ];
  }, [mode, th, mu, T, RT, zlo0, zhi0]);
  const zlim: [number, number] = mode === 'tpd' ? [-0.2, (1.6 * RT) / 1000] : [zlo0 / 1000, zhi0 / 1000];
  const eqG = eq.G;
  const iters = gm.iters;
  const showIters = iters.length > 14 ? [...iters.slice(0, 8), null, ...iters.slice(-5)] : iters;
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      <PageTitle title="三元公切面与吉布斯能最小化" desc="原问题求相分数（杠杆），对偶问题求化学势（公切面）；互补松弛说明：共存相都在切面上。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="切面距离 Δ(x) = G_L(x) − μ·x" prov="model" sub={`T = ${cel(T, 1)}；μ 由最小化的对偶变量给出`}>
            <div className="plot-box">
              <TernaryPlot d={d} image={img} boundaries={false} onPick={(x) => setX0(x)}>
                {(m) => (
                  <>
                    {d.solids.map((s) => {
                      const r = gm.solidReduced[s.index].r;
                      // 固溶体：标在其切面距离最小的成分处
                      const p = m.px(gm.solidReduced[s.index].x);
                      return (
                        <g key={s.id}>
                          <circle cx={p[0]} cy={p[1]} r={5} fill={Math.abs(r) < 1e-3 ? solidColor(s.index) : COLOR.white} stroke={solidColor(s.index)} strokeWidth={2} />
                          <text x={p[0] + 7} y={p[1] - 6} className="pt-lab">
                            {s.label}: r = {fmtNum(r, 1)}
                          </text>
                        </g>
                      );
                    })}
                    {gm.phases
                      .filter((p) => th.isContinuous(p.si))
                      .map((p, k) => {
                        const q = m.px(p.x);
                        return <circle key={k} cx={q[0]} cy={q[1]} r={6} fill="none" stroke={COLOR.stateX0} strokeWidth={2} />;
                      })}
                    <Handle m={m} x={x0} onDrag={(x) => setX0(x)} label="x₀" />
                  </>
                )}
              </TernaryPlot>
            </div>
            <p className="note">
              颜色 ∝ √(Δ/1.5RT)：深蓝 = 液相自由能面贴近切面，黄 = 远高于切面。红圈 = 液相切点（Δ = 0）。实心圆 = 位于切面上的固相（约化成本 r = G_s − μ·n_s = 0）；
              空心 = r &gt; 0（在切面之上，不稳定）。若出现红色区域（Δ &lt; 0），说明切面不是支撑面 —— 最小化尚未收敛。
            </p>
          </Panel>
          <Panel title="自由能曲面与公切面（三维）" prov="model" right={<Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'tpd', label: '相对切面高度' }, { value: 'raw', label: '原始 G 与切面' }]} />}>
            <Axo3D zlim={zlim} zlabel={mode === 'tpd' ? 'Δ / kJ' : 'G / kJ'} zfmt={(v) => v.toFixed(1)} surfaces={surf} height={330} labels={sym}>
              {(m) =>
                d.solids.filter((s) => !s.sol).map((s) => {
                  const g = mode === 'tpd' ? gm.solidReduced[s.index].r / 1000 : th.Gphase(s.index, s.n, T) / 1000;
                  const top = m.p(s.n, Math.min(zlim[1], g));
                  const bot = m.p(s.n, zlim[0]);
                  return (
                    <g key={s.id}>
                      <line x1={bot[0]} y1={bot[1]} x2={top[0]} y2={top[1]} stroke={solidColor(s.index)} strokeWidth={1.4} />
                      <circle cx={top[0]} cy={top[1]} r={4.5} fill={solidColor(s.index)} stroke={COLOR.ink} />
                      <text x={top[0] + 6} y={top[1] - 4} className="pt-lab">{s.label}</text>
                    </g>
                  );
                })
              }
            </Axo3D>
            <p className="note">{mode === 'tpd' ? '灰色平面 = 公切面（此视图中被变换为 z = 0）。液相曲面在切面上方，只在切点处接触。' : '灰色平面 = μ·x；所有自由能点 / 面都在其上方或其上（支撑超平面）。'}</p>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="最小化结果与独立对照" prov="model">
            <table className="grid">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>相组合与分数</th>
                  <th>G / (J·mol⁻¹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>线性规划 + 列生成（本节）</td>
                  <td>{gm.phases.map((p) => `${p.id} ${(p.frac * 100).toFixed(3)}%`).join('，')}</td>
                  <td className="num">{fmtNum(gm.G, 4)}</td>
                </tr>
                <tr>
                  <td>构造式求解器 PhaseDiagram.equilibrium</td>
                  <td>{eq.phases.map((p) => `${p.id} ${(p.frac * 100).toFixed(3)}%`).join('，')}</td>
                  <td className="num">{fmtNum(eqG, 4)}</td>
                </tr>
              </tbody>
            </table>
            <KV
              rows={[
                ['化学势 μ = (μ_A, μ_B, μ_C)', <span className="mono">({mu.map((v) => fmtNum(v, 2)).join(', ')}) J/mol</span>],
                ['原可行性 ‖Σfc − x₀‖∞', <span className="mono">{gm.massResidual.toExponential(2)}</span>],
                ['对偶可行性 min r（≥ 0）', <span className="mono">{fmtNum(gm.minReducedCost, 6)} J/mol</span>],
                ['互补松弛（在解中的相，G − μ·x）', <span className="mono">{gm.phases.map((p) => `${p.id}: ${fmtNum(th.Gphase(p.si, p.x, T) - planeAt(mu, p.x), 4)}`).join('；')}</span>],
                ['|G_LP − G_构造|', <span className={Math.abs(gm.G - eqG) < 1e-2 ? 'ok' : 'bad'}>{Math.abs(gm.G - eqG).toExponential(2)} J/mol</span>],
                ['收敛 / 迭代数', <span className="mono">{gm.converged ? '是' : '否'} / {iters.length}</span>],
              ]}
            />
            {gm.phases.some((p) => p.si < 0) && (
              <p className="note">
                液相化学势核对：μᴸ(x_L) = ({th.muLiq(gm.phases.find((p) => p.si < 0)!.x, T).map((v) => fmtNum(v, 2)).join(', ')})，应等于对偶 μ（列生成收敛精度 ≲ 0.1 J/mol）。
              </p>
            )}
          </Panel>
          {mu.some((v) => !Number.isFinite(v)) && (
            <div className="callout warn">
              x₀ 位于成分三角形的边（或顶点）上：所有平衡相都不含缺失组元，问题精确退化为二元（一元）问题，缺失组元的化学势 μ = −∞。
              切面退化为该边上的公切线（由二元下凸包精确求得），因此没有单纯形迭代；左图中只有这条边上的切面距离是有限的。
            </div>
          )}
          <Panel title="列生成迭代（单纯形）" prov="model" sub="每轮：解受限 LP → 求对偶 μ → 找最负约化成本的相点加入">
            <table className="grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>基（3 个相点）</th>
                  <th>G</th>
                  <th>入基</th>
                  <th>约化成本</th>
                </tr>
              </thead>
              <tbody>
                {showIters.map((it, k) =>
                  it ? (
                    <tr key={k}>
                      <td className="num">{it.it}</td>
                      <td>{it.basis.join(', ')}</td>
                      <td className="num">{fmtNum(it.G, 3)}</td>
                      <td>{it.entering}</td>
                      <td className="num">{fmtNum(it.reducedCost, 4)}</td>
                    </tr>
                  ) : (
                    <tr key={k}>
                      <td colSpan={5} className="dim">…</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </Panel>
          <Derivation
            title="推导：最小化、杠杆规则与公切面是同一个问题"
            steps={[
              { kind: 'known', body: <>候选相点 j：成分 c_j、自由能 G_j（固相为点，液相为连续曲面上的点）。</> },
              { kind: 'govern', title: '原问题', body: <Eq>min_f Σ f_j G_j　s.t.　C f = x₀,　f ≥ 0</Eq> },
              { kind: 'govern', title: '对偶问题', body: <Eq>max_μ μ·x₀　s.t.　μ·c_j ≤ G_j　∀ j</Eq> },
              { kind: 'op', body: <>强对偶：最优时 Σ f_j G_j = μ·x₀。互补松弛：<M>f_j &gt; 0 ⇒ G_j = μ·c_j</M>。</> },
              { kind: 'mid', body: <>{'{'}G = μ·x{'}'} 是一张平面；约束 μ·c ≤ G 表示所有相都在平面之上；有正分数的相都在平面上 —— 这就是"公切面"。</> },
              { kind: 'mid', body: <>液相为连续曲面：在切点处 ∇(G_L − μ·x) = 0 ⇒ μᴸᵢ(x_L) = μᵢ（化学势相等）。</> },
              { kind: 'result', body: <>原问题的约束 C f = x₀ 就是杠杆 / 重心规则（线性部分）；对偶约束是热力学稳定性（非线性部分来自 G 的形状）。</> },
              { kind: 'phys', body: <>约化成本 r_j = G_j − μ·c_j 是相 j 析出的驱动力的相反数：r &lt; 0 的相可以自发析出，平衡时所有 r ≥ 0。</> },
              { kind: 'valid', body: <>恒 T、P；忽略界面与应变能；G 模型为示意参数。液相曲面若非凸（Ω 大），列生成仍正确（可同时生成两个液相点 = 液相分层），但构造式求解器不支持该情形。</> },
            ]}
          />
          <Panel title="哪些是线性的，哪些不是" prov="math">
            <p>
              线性：守恒约束 C f = x₀（杠杆、重心、直线规则全部来自这里）、对偶约束对 μ 是线性的、反应零空间。
              非线性：G_φ(x, T) 的形状 —— 理想混合熵 RT Σx ln x 与过剩项 Ωx_ix_j 决定了切点在哪里、哪些相稳定。相图的"拓扑"由非线性的 G 决定，"读数规则"由线性的守恒决定。
            </p>
            <p className="note">x₀ = ({x0.map((v) => fmtNum(v, 3)).join(', ')})。</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
