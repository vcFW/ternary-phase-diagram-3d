import { useState } from 'react';
import { solidColor } from '../../core/colors';
import type { Comp } from '../../core/types';
import { det, fmtNum, inverse, matMul, matVec, rank } from '../../math/linalg';
import { E_MAT, H_MAT, M_LIN } from '../../math/spaces';
import { GeometryPanel } from '../../panels/PointPanels';
import { usePointAnalysis } from '../../state/derived';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Arrow, Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { Derivation, KV, MatrixView, Panel, Prov, VecView } from '../../viz/MathView';
import { Segmented } from '../../ui/controls';
import { COLOR } from '../../ui/tokens';
import { TeXBlock, TeX } from '../../viz/TeX';

/**
 * 成分向量：为什么一个物理状态可以写成向量？
 * 因为"混合"是线性运算：把两份物料按质量比混合，所得成分是二者的凸组合。成分空间因此天然是仿射空间，
 * 而三角形图只是这个仿射平面的一种坐标表示。
 */
export function VectorsSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const an = usePointAnalysis();
  const [view, setView] = useState<'affine' | 'heights'>('affine');
  const sym = d.params.components.map((c) => c.symbol);
  const uv1 = matVec(H_MAT, x0);
  const Hi = inverse(H_MAT)!;
  const back = matVec(Hi, uv1);
  const res = Math.max(...back.map((v, i) => Math.abs(v - x0[i])));
  const ME = matMul(M_LIN, E_MAT);
  return (
    <>
      <PageTitle title="成分向量与坐标变换" desc="成分是向量；三角形图是满足 Σxᵢ = 1 的仿射平面上的一个坐标系。" />
      <div className="cols c12">
        <div className="stack">
          <Panel
            title="成分三角形中的向量分解"
            prov="math"
            right={<Segmented size="sm" value={view} onChange={setView} options={[{ value: 'affine', label: '以 A 为原点的分解' }, { value: 'heights', label: '到对边的距离' }]} />}
          >
            <div className="plot-box tall">
              <TernaryPlot d={d} background="none" boundaries={false} invariants={false} solids={false} onPick={(x) => setX0(x)}>
                {(m) => {
                  const A = m.px([1, 0, 0]);
                  const P = m.px(x0);
                  if (view === 'affine') {
                    const pB = m.px([1 - x0[1], x0[1], 0]);
                    return (
                      <>
                        <Arrow p={A} q={pB} cls="vec" />
                        <Arrow p={pB} q={P} cls="grad" />
                        <line x1={A[0]} y1={A[1]} x2={P[0]} y2={P[1]} className="lnk dash" />
                        <text x={(A[0] + pB[0]) / 2} y={(A[1] + pB[1]) / 2 + 14} className="pt-lab" fill={COLOR.component[1]}>x_B·(B − A)</text>
                        <text x={(pB[0] + P[0]) / 2 + 6} y={(pB[1] + P[1]) / 2} className="pt-lab" fill={COLOR.component[0]}>x_C·(C − A)</text>
                        <Handle m={m} x={x0} onDrag={(x) => setX0(x)} label="x₀" />
                      </>
                    );
                  }
                  // 到三条对边的垂足：x_i = 垂直距离 / 高
                  const lines = [0, 1, 2].map((i) => {
                    const unit = (k: number): Comp => {
                      const c: Comp = [0, 0, 0];
                      c[k] = 1;
                      return c;
                    };
                    const p1 = m.px(unit((i + 1) % 3));
                    const p2 = m.px(unit((i + 2) % 3));
                    const dx = p2[0] - p1[0];
                    const dy = p2[1] - p1[1];
                    const t = ((P[0] - p1[0]) * dx + (P[1] - p1[1]) * dy) / (dx * dx + dy * dy);
                    return { i, foot: [p1[0] + t * dx, p1[1] + t * dy] as [number, number] };
                  });
                  return (
                    <>
                      {lines.map(({ i, foot }) => (
                        <g key={i}>
                          <line x1={P[0]} y1={P[1]} x2={foot[0]} y2={foot[1]} stroke={solidColor(i)} strokeWidth={2} />
                          <text x={(P[0] + foot[0]) / 2 + 4} y={(P[1] + foot[1]) / 2} className="pt-lab" fill={solidColor(i)}>
                            x_{sym[i]} = {x0[i].toFixed(3)}
                          </text>
                        </g>
                      ))}
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x)} label="x₀" />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            {view === 'affine' ? (
              <TeXBlock>{String.raw`x_0 = A + x_B (B - A) + x_C (C - A) = x_A A + x_B B + x_C C,\quad x_A + x_B + x_C = 1`}</TeXBlock>
            ) : (
              <TeXBlock note="（h_i 为到顶点 i 对边的垂直距离，h 为三角形的高）">{String.raw`x_i = h_i / h`}</TeXBlock>
            )}
            <p className="note">拖动红点（或在图中单击）改变全局总成分 x₀。两种读法给出完全相同的数：它们是同一个仿射坐标的两种几何解释。</p>
          </Panel>
          <Panel title="为什么物理状态可以用向量表示" prov="math">
            <p>
              混合是线性运算：把 m₁ 份成分 c₁ 与 m₂ 份成分 c₂ 混合，总成分 <TeX>{String.raw`c = \frac{m_1 c_1 + m_2 c_2}{m_1 + m_2}`}</TeX>。这个式子只用到向量加法与数乘，
              所以"成分"天然生活在一个向量（更准确地说是仿射）空间里；三角形内部恰好是所有非负权重的凸组合。
            </p>
            <p>约束 <TeX>{String.raw`\mathbf 1^{\mathsf T} x = 1`}</TeX> 使 R³ 中的成分落在一个二维平面上 —— 三元成分只有 2 个自由度，再加温度共 3 个：这就是三维相图的由来。</p>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="当前状态的向量与连结线（与工作台检查器同源）" prov="model">
            {an ? <GeometryPanel an={an} /> : <p className="dim">计算中…</p>}
          </Panel>
          <Panel title="坐标变换矩阵" prov="math" sub="顶点齐次坐标">
            <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <MatrixView name="H" M={H_MAT} colLabels={sym} colColors={[0, 1, 2].map(solidColor)} rowLabels={['u', 'v', '1']} />
              <VecView name="x₀" v={x0} labels={sym} />
            </div>
            <TeXBlock>{String.raw`[u,v,1]^{\mathsf T} = H x_0 = [` + uv1.map((v) => fmtNum(v, 4)).join(',\\ ') + String.raw`]^{\mathsf T}`}</TeXBlock>
            <KV
              rows={[
                ['det H', <span className="mono">{fmtNum(det(H_MAT), 6)} = √3/2 ≠ 0</span>],
                ['rank H', <span className="mono">{rank(H_MAT)}</span>],
                ['反变换 H⁻¹[u,v,1]ᵀ', <span className="mono">({back.map((v) => fmtNum(v, 6)).join(', ')})</span>],
                ['往返误差 ‖x − H⁻¹Hx‖∞', <span className="mono">{res.toExponential(2)}</span>],
              ]}
            />
            <MatrixView name="H⁻¹" M={Hi} digits={4} />
            <p className="note">H 的三列就是三个顶点 A、B、C 的齐次坐标 —— 矩阵的列与几何点一一对应。</p>
          </Panel>
          <Panel title="线性部分 M 与约束子空间" prov="math">
            <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <MatrixView name="M" M={M_LIN} colLabels={sym} />
              <MatrixView name="E" M={E_MAT} rowLabels={sym} colLabels={['dx_A', 'dx_B']} />
              <MatrixView name="ME" M={ME} />
            </div>
            <p>
              不带齐次行的 2×3 矩阵 M 秩为 2，零空间为 span(e_A) —— 但 e_A 不满足 Σdxᵢ = 0，<b>不在约束平面的方向空间内</b>。
              限制在方向空间（基 E）上，映射为 ME，det(ME) = {fmtNum(det(ME), 4)} ≠ 0，因此在相图允许的成分上是双射。
            </p>
            <p className="note">
              <Prov k="math" /> 结论：成分 ⇄ 三角形坐标不丢失任何信息。信息损失只发生在下一节的温度投影 P 中。
            </p>
          </Panel>
          <Derivation
            title="推导：重心坐标的唯一性"
            steps={[
              { kind: 'known', body: <>顶点 A、B、C 的平面坐标；目标点 P = (u, v)。</> },
              { kind: 'govern', body: <TeXBlock>{String.raw`P = x_A A + x_B B + x_C C,\quad x_A + x_B + x_C = 1`}</TeXBlock> },
              { kind: 'op', body: <>写成矩阵：<TeX>{String.raw`H x = [u, v, 1]^{\mathsf T}`}</TeX>，H 的列为顶点的齐次坐标。</> },
              { kind: 'mid', body: <>det H = 2·S△ABC = √3/2 ≠ 0（顶点不共线）。</> },
              { kind: 'result', body: <>x = H⁻¹[u, v, 1]ᵀ 唯一存在；且 xᵢ = S(P 与另两顶点构成的三角形)/S△ABC（Cramer 法则）。</> },
              { kind: 'phys', body: <>"杠杆规则""重心规则"所用的正是这组坐标 —— 只是把顶点换成了平衡相的成分点（见"相分数的线性方程组"）。</> },
              { kind: 'valid', body: <>仅要求三个参考点不共线；对任何三个线性无关的成分点都成立。</> },
            ]}
          />
        </div>
      </div>
    </>
  );
}
