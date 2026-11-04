import { useMemo } from 'react';
import { cel, toC } from '../../core/colors';
import { fmtNum } from '../../math/linalg';
import { invariantAnalyses } from '../../state/derived';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { XYPlot, type Series } from '../../viz/XYPlot';
import { Eq, M, Panel, Prov } from '../../viz/MathView';
import { COLOR, SERIES } from '../../ui/tokens';

const PAL: readonly string[] = SERIES;

/**
 * 两种常被混用的"自由能图"：
 *   (1) 成分相关的自由能曲面 G_φ(x, T) —— 相平衡计算的对象（公切面）；
 *   (2) 反应吉布斯能 ΔG_r(T) = Σνᵢ Gᵢ —— 成分已固定的若干相之间某一个反应的标量。
 */
export function ReactionGSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const inv = invariantAnalyses(d).filter((a) => a.thermo);
  const { Tmin, Tmax } = d.tRange();
  const series: Series[] = useMemo(
    () =>
      inv.map((a, k) => ({
        id: a.iv.id,
        pts: [Tmin, Tmax].map((TT) => [toC(TT), a.thermo!.dG(TT)] as [number, number]),
        color: PAL[k % PAL.length],
        label: `${a.iv.label}: ${a.rx.text}`,
      })),
    [inv, Tmin, Tmax],
  );
  // 沿 A→B 方向过 x₀ 的液相自由能曲线（成分相关）
  const gl: Series[] = useMemo(() => {
    const pts: [number, number][] = [];
    for (let k = 1; k < 200; k++) {
      const t = k / 200;
      const x: [number, number, number] = [(1 - t) * (x0[0] + x0[1]), t * (x0[0] + x0[1]), x0[2]];
      pts.push([t, d.th.Gliq(x, T) / 1000]);
    }
    return [{ id: 'g', pts, color: COLOR.phase.liquid, label: `G_L(x, T) 沿 x_C = ${x0[2].toFixed(2)} 的截线` }];
  }, [d, x0, T]);
  return (
    <>
      <PageTitle title="ΔG_r 与自由能曲面的区别" desc="相平衡用的是成分的函数 G_φ(x, T)；反应方向用的是固定成分之间的标量 ΔG_r(T)。" />
      <div className="cols c2">
        <Panel title="(1) 成分相关的自由能曲面 G_φ(x, T)" prov="model">
          <XYPlot height={230} series={gl} xlim={[0, 1]} xlabel="截线参数 t（x_B / (x_A + x_B)）" ylabel="G_L / (kJ·mol⁻¹)" />
          <ul className="plain">
            <li>自变量：成分 x（与 T）。是一个<b>函数</b>，有形状（凸 / 非凸）。</li>
            <li>用途：公切线 / 公切面 ⇒ 哪些相共存、各相成分是多少。</li>
            <li>斜率有意义：∂G/∂x 给出化学势之差。</li>
            <li>不能直接回答"某个反应往哪走"——因为它没有指定反应。</li>
          </ul>
        </Panel>
        <Panel title="(2) 反应吉布斯能 ΔG_r(T) = Σ νᵢ Gᵢ" prov="model" sub="各不变点反应，相成分固定在不变点处">
          {!inv.length && <p className="dim">该体系没有不变点反应（例如三元匀晶），因此没有可画的 ΔG_r(T)。</p>}
          <XYPlot height={230} series={series} xlabel="T / °C" ylabel="ΔG_r / (J·mol⁻¹)" hlines={[{ y: 0, color: COLOR.ink, dash: '' }]} vlines={inv.map((a) => ({ x: toC(a.iv.T), color: COLOR.muted }))} />
          <table className="grid">
            <thead>
              <tr>
                <th>不变点</th>
                <th>反应（ν_L = −1）</th>
                <th>ΔH_r</th>
                <th>ΔS_r</th>
                <th>ΔG_r = 0 于</th>
                <th>T_inv</th>
              </tr>
            </thead>
            <tbody>
              {inv.map((a) => (
                <tr key={a.iv.id}>
                  <td>{a.iv.label}</td>
                  <td className="mono">{a.rx.text}</td>
                  <td className="num">{fmtNum(a.thermo!.dH, 1)}</td>
                  <td className="num">{fmtNum(a.thermo!.dS, 3)}</td>
                  <td className="num">{cel(a.thermo!.T0, 2)}</td>
                  <td className="num">{cel(a.iv.T, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <div className="cols c2" style={{ marginTop: 10 }}>
        <Panel title="两者如何联系" prov="math">
          <p>在不变点，四相共切面 μ：每相 Gᵢ = μ·cᵢ。于是</p>
          <Eq>ΔG_r = Σ νᵢ Gᵢ = μ·(Σ νᵢ cᵢ) = μ·(Nν) = 0</Eq>
          <p>
            —— 守恒（Nν = 0）与公切面一起，<b>推出</b>不变点温度处 ΔG_r = 0。表中两列温度一致正是这一点的数值验证。
            离开 T_inv，ΔG_r = ΔH_r − TΔS_r（本模型 ΔCp = 0），降温时 ΔG_r &lt; 0 ⇔ ΔS_r &lt; 0（消耗液相放出熵 / 潜热）。
          </p>
        </Panel>
        <Panel title="不要做的替代" prov="assume">
          <p>
            常见的"反应坐标—能量"一维示意图（能垒、过渡态）描述的是动力学路径，与多组元相平衡模型不是一回事：它没有成分自变量，无法给出公切面、相组成或相分数。
            本平台的所有平衡结论都来自真实的多组元 G 模型（尽管参数为示意值）。
          </p>
          <p className="note">
            <Prov k="unknown" /> 本模型不含动力学（形核、扩散），因此不能预测过冷度或反应速率。
          </p>
          <p className="note">当前 T = {cel(T, 1)}。<M>ΔG_r</M> 的单位为每摩尔液相。</p>
        </Panel>
      </div>
    </>
  );
}
