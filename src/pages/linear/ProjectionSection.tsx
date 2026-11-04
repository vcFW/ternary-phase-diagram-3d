import { useMemo, useState } from 'react';
import { colormapCss } from '../../core/colormap';
import { cel, toC, toK } from '../../core/colors';
import { fmtNum, svd } from '../../math/linalg';
import { analyzeMap, P_MAT, project, reconstructT } from '../../math/spaces';
import { useStore } from '../../state/store';
import { Axo3D, type Surface } from '../../viz/Axo3D';
import { PageTitle } from '../../viz/PageLayout';
import { Derivation, Eq, KV, M, MatrixView, Panel, Prov } from '../../viz/MathView';
import { Segmented, SliderRow } from '../../ui/controls';
import { LocalParam } from '../../ui/LocalParam';
import { COLOR } from '../../ui/tokens';

/**
 * 投影 P:(x_A, x_B, T) → (x_A, x_B) 的信息论：rank 2、零空间 span(e_T)。
 * 交互：同一竖直"纤维"上的不同温度状态投影到同一点；只有加入"状态在液相面上"这一约束，温度才可恢复。
 */
export function ProjectionSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const setT = useStore((s) => s.setT);
  const { Tmin, Tmax } = d.tRange();
  const [T2, setT2] = useState(() => Math.min(Tmax, T + 150));
  const [step, setStep] = useState(50);
  const [vmat, setVmat] = useState<number[][]>(() => viewMat(-0.62, 0.42));
  const an = analyzeMap('P', P_MAT);
  const rc = reconstructT(d, x0, step);
  const Tl = d.liquidus(x0).T;
  const q = project([x0[0], x0[1], T]);
  const q2 = project([x0[0], x0[1], T2]);
  const surf: Surface[] = useMemo(
    () => [
      {
        N: 26,
        f: (x) => d.liquidus(x).T,
        color: (_x, v) => colormapCss('parula', (v - Tmin) / (Tmax - Tmin)),
        opacity: 0.88,
      },
    ],
    [d, Tmin, Tmax],
  );
  const vs = svd(vmat).S;
  return (
    <>
      <PageTitle title="三维 → 二维投影与信息损失" desc="二维液相面投影究竟保留了什么、压缩了什么、丢失了什么？" />
      <div className="cols c21">
        <div className="stack">
          <Panel title="状态空间 (x_A, x_B, T) 与投影纤维" prov="model" sub="液相面由热力学模型计算">
            <Axo3D zlim={[Tmin, Tmax]} zlabel="T/°C" zfmt={(v) => toC(v).toFixed(0)} surfaces={surf} height={400} labels={d.params.components.map((c) => c.symbol)} onView={(v) => setVmat(viewMat(v.az, v.el))}>
              {(m) => {
                const base = m.p(x0, Tmin);
                const top = m.p(x0, Tmax);
                const s1 = m.p(x0, T);
                const s2 = m.p(x0, T2);
                const sl = m.p(x0, Tl);
                return (
                  <>
                    <line x1={base[0]} y1={base[1]} x2={top[0]} y2={top[1]} stroke={COLOR.path} strokeWidth={1.6} strokeDasharray="5 3" />
                    <circle cx={sl[0]} cy={sl[1]} r={5} fill={COLOR.component[2]} stroke={COLOR.ink} />
                    <circle cx={s1[0]} cy={s1[1]} r={5} fill={COLOR.stateX0} stroke={COLOR.white} strokeWidth={1.5} />
                    <circle cx={s2[0]} cy={s2[1]} r={5} fill={COLOR.accent} stroke={COLOR.white} strokeWidth={1.5} />
                    <circle cx={base[0]} cy={base[1]} r={4.5} fill={COLOR.ink} />
                    <text x={s1[0] + 8} y={s1[1] + 4} className="pt-lab" fill={COLOR.stateX0}>q₁ = (x₀, T)</text>
                    <text x={s2[0] + 8} y={s2[1] + 4} className="pt-lab" fill={COLOR.accent}>q₂ = (x₀, T′)</text>
                    <text x={sl[0] - 8} y={sl[1] - 6} className="pt-lab" fill={COLOR.ok} textAnchor="end">液相面交点</text>
                    <text x={base[0] + 8} y={base[1] + 14} className="pt-lab">P(q₁) = P(q₂)</text>
                  </>
                );
              }}
            </Axo3D>
            <SliderRow label="状态 q₁ 的 T" labelWidth={92} value={toC(T)} min={Math.ceil(toC(Tmin))} max={Math.floor(toC(Tmax))} step={1} unit="°C" color={COLOR.stateX0} onChange={(v) => setT(toK(v))} />
            <LocalParam label="状态 q₂ 的 T′" labelWidth={92} value={toC(T2)} min={Math.ceil(toC(Tmin))} max={Math.floor(toC(Tmax))} step={1} unit="°C" color={COLOR.accent} onChange={(v) => setT2(toK(v))} />
            <div className="callout">
              q₁ = ({fmtNum(x0[0], 3)}, {fmtNum(x0[1], 3)}, {toC(T).toFixed(0)} °C) 与 q₂ = ({fmtNum(x0[0], 3)}, {fmtNum(x0[1], 3)}, {toC(T2).toFixed(0)} °C)
              的投影都是 ({fmtNum(q[0], 3)}, {fmtNum(q[1], 3)}) = ({fmtNum(q2[0], 3)}, {fmtNum(q2[1], 3)})。紫色虚线即纤维 P⁻¹(x_A, x_B)：整条线被压成一个点。
            </div>
          </Panel>
          <Panel title="恢复温度需要什么附加信息？" prov="math" right={<Segmented size="sm" value={step} onChange={setStep} options={[25, 50, 100].map((v) => ({ value: v, label: `ΔT = ${v} K` }))} />}>
            <table className="grid">
              <thead>
                <tr>
                  <th>可用信息</th>
                  <th>能否确定 T</th>
                  <th>结果</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>只有二维成分坐标 (x_A, x_B)</td>
                  <td><Prov k="unknown" /></td>
                  <td>T ∈ (−∞, ∞)</td>
                  <td>{rc.none.reason}</td>
                </tr>
                <tr>
                  <td>+ 已知该状态在液相面上，且有完整函数 T_liq(x)</td>
                  <td><Prov k="model" /></td>
                  <td className="num">{cel(rc.surface.T, 2)}</td>
                  <td>{rc.surface.reason}</td>
                </tr>
                <tr>
                  <td>+ 在液相面上，但只有间隔 {step} K 的等温线</td>
                  <td>{rc.contours.bandHasExtremum ? <Prov k="unknown" /> : <Prov k="math" title="区间界定" />}</td>
                  <td className="num">[{toC(rc.contours.lo).toFixed(0)}, {toC(rc.contours.hi).toFixed(0)}] °C</td>
                  <td>{rc.contours.reason}</td>
                </tr>
                <tr>
                  <td>+ 界线上的降温箭头</td>
                  <td><Prov k="math" /></td>
                  <td>sign(dT/ds)</td>
                  <td>每段界线只保留温度变化的符号（1 比特），不保留数值。</td>
                </tr>
                <tr>
                  <td>+ 不变点标注温度</td>
                  <td><Prov k="model" /></td>
                  <td>离散点的 T</td>
                  <td>只在少数点上恢复了被投影丢掉的坐标。</td>
                </tr>
              </tbody>
            </table>
            <p className="note">
              任意状态 (x, T) 若不在液相面上（例如两相区内部），二维液相面投影<b>完全不含</b>它的温度；需要等温截面或垂直截面（另一族投影 / 切片）补充。
            </p>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="投影矩阵 P" prov="math">
            <MatrixView name="P" M={P_MAT} colLabels={['x_A', 'x_B', 'T']} rowLabels={['x_A', 'x_B']} hiCol={2} />
            <KV
              rows={[
                ['rank P', <span className="mono">{an.rank}</span>],
                ['奇异值', <span className="mono">{an.singular.map((v) => fmtNum(v, 3)).join(', ')}</span>],
                ['零空间 ker P', <span className="mono">span{'{'}({an.nullBasis[0].map((v) => fmtNum(Math.abs(v), 0)).join(', ')}){'}'} = span(e_T)</span>],
                ['dim ker P', <span className="mono">3 − 2 = 1</span>],
              ]}
            />
            <p>{an.verdict}</p>
          </Panel>
          <Panel title="保留 · 压缩 · 丢失" prov="math">
            <table className="grid">
              <tbody>
                <tr><th>完全保留</th><td>成分坐标；直线 ↦ 直线、比值 ↦ 比值（线性映射保持共线性与线段比 —— 所以杠杆规则在投影图上仍可直接使用）。</td></tr>
                <tr><th>压缩保留</th><td>液相面高度 → 等值线族；界线上的温度 → 箭头方向；不变点 → 标注数值。</td></tr>
                <tr><th>丢失</th><td>任意非液相面状态的温度；两条等温线之间的精确温度；三维曲面的坡度只剩"等温线疏密"。</td></tr>
                <tr><th>可能混淆</th><td>三维中不相交的两条曲线可能在投影中相交（不同温度）；二维交点不一定是物理不变点 —— 需核对温度。</td></tr>
              </tbody>
            </table>
          </Panel>
          <Panel title="看三维图本身也是一次投影" prov="math" sub="拖动左图旋转">
            <MatrixView name="V" M={vmat} colLabels={['u', 'v', 'z']} digits={3} />
            <p>
              屏幕坐标 = V·w，V 为 2×3、rank = 2（奇异值 {vs.slice(0, 2).map((v) => v.toFixed(3)).join(', ')}），零空间是视线方向。
              旋转视角就是换一个零空间方向：俯视（仰角 90°）时 V 的零空间 = e_z，正好退化为液相面投影 P。
            </p>
          </Panel>
          <Derivation
            title="推导：为什么温度一般不能从投影唯一恢复"
            steps={[
              { kind: 'known', body: <>独立坐标 q = (x_A, x_B, T) ∈ R³；投影 P q = (x_A, x_B)。</> },
              { kind: 'govern', body: <>秩–零化度定理：<M>dim ker P + rank P = 3</M>。</> },
              { kind: 'op', body: <>P 的前两列为单位向量、第三列为 0 ⇒ rank P = 2，ker P = span(e_T)。</> },
              { kind: 'mid', body: <>P(q + t·e_T) = P q 对任意 t 成立：纤维是竖直直线。</> },
              { kind: 'result', body: <>P 不是单射 ⇒ 不存在左逆；温度不能只由投影恢复。</> },
              { kind: 'op', title: '加入约束', body: <>若已知 q 在曲面 {'{'}T = T_liq(x){'}'} 上，则纤维与曲面的交点为 (x, T_liq(x))。液相面 = max_s T_s(x) 是单值函数 ⇒ 交点唯一。</> },
              { kind: 'result', body: <Eq>P|_液相面 是双射，其逆为 x ↦ (x, T_liq(x))</Eq> },
              { kind: 'phys', body: <>二维液相面投影之所以"可读"，是因为读者默认状态在液相面上；等温线就是这个逆映射的离散近似。</> },
              { kind: 'valid', body: <>液相面必须单值（本模型成立）；若存在液–液分层（穹顶），同一成分可能对应多个液相线温度，单射性失效。</> },
            ]}
          />
        </div>
      </div>
    </>
  );
}

function viewMat(az: number, el: number): number[][] {
  return [
    [Math.cos(az), Math.sin(az), 0],
    [-Math.sin(el) * Math.sin(az), Math.sin(el) * Math.cos(az), Math.cos(el)],
  ];
}
