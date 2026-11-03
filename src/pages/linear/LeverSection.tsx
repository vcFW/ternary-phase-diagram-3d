import { useEffect, useMemo, useState } from 'react';
import { cel, phaseColor, solidColor } from '../../core/colors';
import type { Comp } from '../../core/types';
import { combine, phaseFractions } from '../../math/lever';
import { fmtNum, gaussSteps } from '../../math/linalg';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { Derivation, Eq, KV, M, MatrixView, Panel, Prov, type Step } from '../../viz/MathView';
import { Chip, SliderRow, Toggle } from '../../ui/controls';

interface Ph {
  id: string;
  x: Comp;
  color: string;
}

/**
 * 相分数 = 约束线性方程组  A f = b，f ≥ 0。
 * 矩阵的列 ⇔ 几何上的相成分点 ⇔ 物理上的平衡相（悬停列即高亮对应点与子三角形）。
 */
export function LeverSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  const setX0 = useStore((s) => s.setX0);
  const [follow, setFollow] = useState(true);
  const [chosen, setChosen] = useState<string[]>(eq.phases.map((p) => p.id));
  const [hi, setHi] = useState<number | null>(null);
  const sym = d.params.components.map((c) => c.symbol);
  const liq = eq.phases.find((p) => p.si < 0);
  const avail: Ph[] = useMemo(
    () => [...(liq ? [{ id: 'L', x: liq.x, color: phaseColor(d, 'L') }] : []), ...d.solids.map((s) => ({ id: s.id, x: s.n, color: solidColor(s.index) }))],
    [d, liq],
  );
  useEffect(() => {
    if (follow) setChosen(eq.phases.map((p) => p.id));
  }, [follow, eq]);
  const phases = chosen.map((id) => avail.find((a) => a.id === id)).filter((p): p is Ph => !!p);
  const r = phases.length ? phaseFractions(phases.map((p) => p.x), x0) : null;
  const toggle = (id: string) => {
    setFollow(false);
    setChosen((c) => (c.includes(id) ? c.filter((v) => v !== id) : c.length >= 4 ? c : [...c, id]));
  };
  const colLabels = phases.map((p) => p.id);
  const colColors = phases.map((p) => (p.id === 'L' ? '#3a78b5' : p.color));
  const elim = r && r.k >= 2 && r.k <= 3 ? gaussSteps(r.A.map((row, i) => [...row, r.b[i]]), ['x_A 行', 'x_B 行', 'Σ 行']) : null;
  const setF = (j: number, v: number) => {
    if (!r?.f || phases.length < 2) return;
    const f = r.f.slice();
    const others = f.map((_, i) => i).filter((i) => i !== j);
    const rest = 1 - v;
    const so = others.reduce((s, i) => s + Math.max(0, f[i]), 0);
    for (const i of others) f[i] = so > 1e-12 ? (Math.max(0, f[i]) / so) * rest : rest / others.length;
    f[j] = v;
    setX0(combine(phases.map((p) => p.x), f));
  };
  const steps: Step[] = r
    ? [
        { kind: 'known', body: <>相成分 {phases.map((p) => `${p.id} = (${p.x.map((v) => fmtNum(v, 3)).join(', ')})`).join('；')}；总成分 c₀ = ({x0.map((v) => fmtNum(v, 3)).join(', ')})，T = {cel(T, 1)}。</> },
        { kind: 'assume', body: <>封闭体系（总量守恒）；各相成分已由平衡计算给定 <Prov k="model" />；求相对数量 f。</> },
        { kind: 'govern', body: <Eq>Σ fᵢ cᵢ = c₀ (3 行),　Σ fᵢ = 1,　fᵢ ≥ 0</Eq> },
        {
          kind: 'op',
          title: '发现冗余',
          body: (
            <>
              <MatrixView name="[A_full | b]" M={r.Afull.map((row, i) => [...row, r.bfull[i]])} rowLabels={[...sym.map((s) => `x_${s}`), 'Σ']} colLabels={[...colLabels, 'c₀']} colColors={[...colColors, '#1d2229']} aug={r.k} hiCol={hi} onHoverCol={setHi} />
              <span>
                rank(A_full) = {r.rankFull} ≤ 3：三行守恒方程之和 = 归一化行（每列分量和为 1）。删去 x_{sym[2]} 行得约化系统。
              </span>
            </>
          ),
        },
        {
          kind: 'op',
          title: '约化系统',
          body: (
            <>
              <MatrixView name="[A | b]" M={r.A.map((row, i) => [...row, r.b[i]])} rowLabels={[`x_${sym[0]}`, `x_${sym[1]}`, 'Σ']} colLabels={[...colLabels, 'c₀']} colColors={[...colColors, '#1d2229']} aug={r.k} hiCol={hi} onHoverCol={setHi} />
              <span>
                rank A = {r.rank}，奇异值 {r.singular.map((v) => fmtNum(v, 4)).join(', ')}
                {r.det !== null && <>，det A = {fmtNum(r.det, 5)}</>}，κ(A) = {Number.isFinite(r.cond) ? fmtNum(r.cond, 3) : '∞'}
              </span>
            </>
          ),
        },
        ...(r.cramer && r.det
          ? [
              {
                kind: 'mid' as const,
                title: 'Cramer 法则 = 面积比',
                body: (
                  <>
                    <Eq>fᵢ = det Aᵢ / det A = S(c₀ 替换第 i 个顶点) / S(△)</Eq>
                    <span className="mono">
                      det Aᵢ = ({r.cramer.map((v) => fmtNum(v, 5)).join(', ')})；面积比 = ({r.areas!.sub.map((s) => fmtNum(s / r.areas!.total, 5)).join(', ')})
                    </span>
                  </>
                ),
              },
            ]
          : []),
        ...(elim
          ? [
              {
                kind: 'op' as const,
                title: '列主元高斯消元（与 Cramer 结果核对）',
                body: (
                  <div className="stack" style={{ gap: 4 }}>
                    {elim.steps.map((s, i) => (
                      <div key={i}>
                        <div className="small dim">{s.op}</div>
                        <MatrixView M={s.M} aug={r.k} digits={4} />
                      </div>
                    ))}
                  </div>
                ),
              },
            ]
          : []),
        {
          kind: 'result',
          body: (
            <>
              <span className="mono">f = ({r.f ? r.f.map((v) => fmtNum(v, 5)).join(', ') : '—'})，残差 ‖Af − b‖ = {Number.isFinite(r.residual) ? r.residual.toExponential(2) : '—'}</span>
              <span className={r.status === 'ok' ? 'ok' : 'bad'}>{r.message}</span>
            </>
          ),
        },
        { kind: 'phys', body: <>fᵢ 是相 i 所含原子占总量的分数。f ≥ 0 不是数学结果，而是物理约束：负数意味着"该相组合不可能给出此总成分"。</> },
        { kind: 'valid', body: <>相成分点线性无关（k = 3 时不共线）；成分以摩尔分数（每摩尔原子）计 —— 若以质量分数计，f 为质量分数，方程形式不变。</> },
      ]
    : [];
  return (
    <>
      <PageTitle title="相分数的线性方程组" desc="杠杆规则与重心规则都是同一个约束线性系统 A f = b, f ≥ 0 的解。" />
      <div className="cols c12">
        <div className="stack">
          <Panel
            title="几何：相成分点、连结线 / 连结三角形"
            prov="model"
            sub={`T = ${cel(T, 1)}`}
            right={<Toggle checked={follow} onChange={setFollow} label="跟随平衡相" />}
          >
            <div className="plot-box tall">
              <TernaryPlot d={d} background="fields" boundaries={false} invariants={false} onPick={(x) => setX0(x)}>
                {(m) => {
                  const P = phases.map((p) => m.px(p.x));
                  const c = m.px(x0);
                  const bad = r && (r.status === 'outside' || r.status === 'inconsistent' || r.status === 'singular');
                  return (
                    <>
                      {P.length === 3 && <polygon points={P.map((p) => p.join(',')).join(' ')} className={`tri-fill ${bad ? 'bad' : ''}`} />}
                      {P.length === 2 && <line x1={P[0][0]} y1={P[0][1]} x2={P[1][0]} y2={P[1][1]} className={`lnk ${bad ? 'hi' : ''}`} strokeWidth={2} />}
                      {P.length === 4 && <polygon points={P.map((p) => p.join(',')).join(' ')} className="tri-fill" />}
                      {hi !== null && P.length === 3 && hi < 3 && (
                        <polygon points={[c, P[(hi + 1) % 3], P[(hi + 2) % 3]].map((p) => p.join(',')).join(' ')} fill="rgba(237,177,32,0.45)" stroke="#d95319" />
                      )}
                      {P.map((p, j) => (
                        <line key={`l${j}`} x1={c[0]} y1={c[1]} x2={p[0]} y2={p[1]} stroke={colColors[j]} strokeWidth={hi === j ? 2.4 : 1} strokeDasharray="3 2" />
                      ))}
                      {P.map((p, j) => (
                        <g key={j} onMouseEnter={() => setHi(j)} onMouseLeave={() => setHi(null)}>
                          <circle cx={p[0]} cy={p[1]} r={hi === j ? 8 : 6} fill={colColors[j]} stroke="#1d2229" />
                          <text x={p[0] + 9} y={p[1] - 7} className="pt-lab" fill={colColors[j]}>
                            {phases[j].id}
                            {r?.f ? ` f=${fmtNum(r.f[j], 3)}` : ''}
                          </text>
                        </g>
                      ))}
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x)} label="c₀" />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <div className="sublabel">参与方程的相（点击切换，最多 4 个；关闭"跟随平衡相"即可自由组合做反例）</div>
            <div className="chips">
              {avail.map((a) => (
                <Chip key={a.id} color={a.id === 'L' ? '#3a78b5' : a.color} active={chosen.includes(a.id)} onClick={() => toggle(a.id)}>
                  {a.id === 'L' ? `液相 L（当前平衡液相）` : a.id}
                </Chip>
              ))}
            </div>
            {r?.f && phases.length >= 2 && phases.length <= 3 && r.status !== 'singular' && (
              <>
                <div className="sublabel">拖动相分数 → c₀ = Σ fᵢcᵢ 随之更新（约束 Σf = 1、f ≥ 0）</div>
                {phases.map((p, j) => (
                  <SliderRow key={p.id} label={`f(${p.id})`} labelWidth={52} color={colColors[j]} value={Math.max(0, Math.min(1, r.f![j]))} min={0} max={1} step={0.005} digits={3} onChange={(v) => setF(j, v)} />
                ))}
                <p className="note">注意：若改变后的 c₀ 离开了当前相区，平衡相组合会改变（关闭"跟随平衡相"可固定相组合）。</p>
              </>
            )}
          </Panel>
          {r && (
            <Panel title="数值稳定性" prov="math">
              <KV
                rows={[
                  ['相数 k / 约化方程数', <span className="mono">{r.k} / 3</span>],
                  ['rank A', <span className="mono">{r.rank}</span>],
                  ['κ(A) = σ_max/σ_min', <span className="mono">{Number.isFinite(r.cond) ? fmtNum(r.cond, 4) : '∞（奇异）'}</span>],
                  ['零空间维数', <span className="mono">{r.nullBasis.length}</span>],
                  ['状态', <span className={r.status === 'ok' ? 'ok' : 'bad'}>{r.status}</span>],
                ]}
              />
              <p>
                κ 衡量成分测量误差被放大到相分数的倍数：<M>‖δf‖/‖f‖ ≤ κ(A)·‖δb‖/‖b‖</M>。连结三角形越扁（接近共线），κ 越大；
                三点共线时 det A = 0，κ = ∞，相分数不再唯一。
              </p>
              {r.k === 4 && <div className="callout">k = 4：零空间一维，基向量 ({r.nullBasis[0].map((v) => fmtNum(v, 3)).join(', ')}) 正是四相不变反应的系数方向（见"相图规则与定理 · 不变点与反应"）。</div>}
            </Panel>
          )}
        </div>
        <div className="stack">{r ? <Derivation title="逐步求解相分数" steps={steps} /> : <Panel title="请选择至少一个相">—</Panel>}</div>
      </div>
    </>
  );
}
