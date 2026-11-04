import { useMemo } from 'react';
import { cel, solidColor, toC, toK } from '../../core/colors';
import { fmtNum } from '../../math/linalg';
import { StabilityPanel } from '../../panels/PointPanels';
import { usePointAnalysis } from '../../state/derived';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { XYPlot, type Series } from '../../viz/XYPlot';
import { Derivation, Eq, KV, M, Panel } from '../../viz/MathView';
import { COLOR } from '../../ui/tokens';

/**
 * 温度与相稳定性：均匀液相 x₀ 对每个固相的析出驱动力
 *     Δ_s(T) = Σ nᵢ μᵢᴸ(x₀, T) − G_s(T)
 * Δ_s = 0 的温度正是 T_s(x₀)（闭式解），最先过零的固相即初晶相，其温度即液相线。
 */
export function StabilitySection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const setT = useStore((s) => s.setT);
  const an = usePointAnalysis();
  const th = d.th;
  const { Tmin, Tmax } = d.tRange();
  const data = useMemo(() => {
    const n = 140;
    const df: Series[] = d.solids.map((s) => ({ id: s.id, pts: [] as [number, number][], color: solidColor(s.index), label: `Δ_${s.label}` }));
    const gL: [number, number][] = [];
    const gE: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const TT = Tmin + ((Tmax - Tmin) * k) / n;
      d.solids.forEach((s, i) => {
        // 驱动力 max_y[μᴸ·y − G_s(y)]；化学计量相即 Σnμᴸ − G_s
        df[i].pts.push([toC(TT), th.drivingForce(s.index, x0, TT) / 1000]);
      });
      gL.push([toC(TT), th.Gliq(x0, TT) / 1000]);
      gE.push([toC(TT), d.equilibrium(x0, TT).G / 1000]);
    }
    return { df, gL, gE };
  }, [d, th, x0, Tmin, Tmax]);
  const sats = d.solids.map((s) => ({ s, T: th.Tsat(s.index, x0) })).sort((a, b) => b.T - a.T);
  const liq = th.liquidus(x0);
  const mu = th.muLiq(x0, T);
  return (
    <>
      <PageTitle title="温度与相稳定性" desc="液相线不是一条「画出来的线」，而是均匀液相开始对某个固相失稳的温度：驱动力由负变正。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="均匀液相 x₀ 对各固相的析出驱动力 Δ_s(T)" prov="model">
            <XYPlot
              height={280}
              series={data.df}
              xlabel="T / °C"
              ylabel="Δ_s / (kJ·mol⁻¹)"
              hlines={[{ y: 0, color: COLOR.ink, dash: '' }]}
              vlines={[{ x: toC(liq.T), color: COLOR.stateX0, label: '液相线' }, { x: toC(T), color: COLOR.muted, label: '当前 T' }]}
              onPick={(x) => setT(toK(x))}
            />
            <table className="grid">
              <thead>
                <tr>
                  <th>固相</th>
                  <th>Δ_s(T) 当前</th>
                  <th>过零温度 T_s(x₀)</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {sats.map(({ s, T: ts }) => {
                  const v = th.drivingForce(s.index, x0, T);
                  return (
                    <tr key={s.id}>
                      <td><i className="swatch" style={{ background: solidColor(s.index) }} />{s.label}（{s.formula}）{s.sol && <span className="dim small"> y* = {th.solidComp(s.index, x0, T).map((v) => (v * 100).toFixed(1)).join('/')}%</span>}</td>
                      <td className="num">{fmtNum(v, 1)} J/mol</td>
                      <td className="num">{ts > 0 ? cel(ts, 2) : '—'}</td>
                      <td>{s.index === liq.si ? '最先过零 ⇒ 初晶相，T_s = 液相线' : ts > T ? '当前已过饱和（均匀液相不稳定）' : '未饱和'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">点击图可设置全局温度。驱动力按"每摩尔原子的固相"计。</p>
          </Panel>
          <Panel title="平衡解是否为全局最小（与工作台检查器同源）" prov="model">
            {an ? <StabilityPanel an={an} /> : <p className="dim">计算中…</p>}
          </Panel>
          <Panel title="均匀液相 vs 平衡态的总吉布斯能" prov="model">
            <XYPlot
              height={220}
              series={[
                { id: 'L', pts: data.gL, color: COLOR.phase.liquid, label: 'G_L(x₀, T)：强制保持均匀液相' },
                { id: 'E', pts: data.gE, color: COLOR.stateX0, dash: '5 3', label: 'G_eq(T)：最小化后的平衡态' },
              ]}
              xlabel="T / °C"
              ylabel="G / (kJ·mol⁻¹)"
              vlines={[{ x: toC(liq.T), color: COLOR.stateX0 }]}
            />
            <p>液相线以上两线重合（均匀液相就是最小值）；以下 G_eq &lt; G_L，差值为析晶（相分离）带来的吉布斯能降低。G_eq 在不变点处有斜率突变（熵突变 = 潜热）。</p>
          </Panel>
        </div>
        <div className="stack">
          <Derivation
            title="推导：液相线温度的闭式解"
            steps={[
              { kind: 'known', body: <>液相（正规溶液）化学势 <M>μᵢᴸ = ΔHᵢ(1 − T/Tmᵢ) + RT ln xᵢ + μᵢᴱˣ</M>（以纯固相为基准）；化学计量固相 s（组成 n）<M>G_s = ΔH_f − TΔS_f</M>；固溶体见下方推广。</> },
              { kind: 'govern', body: <Eq>饱和（平衡）条件：Σ nᵢ μᵢᴸ(x, T) = G_s(T)</Eq> },
              { kind: 'op', body: <>左右两边都是 T 的一次函数（正规溶液 S_ex = 0，ΔCp = 0），直接解出 T。</> },
              { kind: 'result', body: <Eq>T_s(x) = (H_s + Σ nᵢ μᵢᴱˣ) / (S_s − R Σ nᵢ ln xᵢ)</Eq> },
              { kind: 'mid', body: <>H_s = Σ nᵢΔHᵢ − ΔH_f，S_s = Σ nᵢΔHᵢ/Tmᵢ − ΔS_f。对纯组元 s = A 且理想液相：T = ΔH_A/(ΔH_A/Tm_A − R ln x_A) —— Schröder–van Laar 方程。</> },
              { kind: 'phys', body: <>Δ_s(T) = Σnμᴸ − G_s 关于 T 单调（斜率 = −(S_s − RΣn ln x) &lt; 0）：降温使驱动力增大。液相面 = max_s T_s(x)：最先失稳的固相决定初晶区。</> },
              { kind: 'op', title: '固溶体的推广', body: <>固相 s 为固溶体时驱动力 Δ_s = max_y [μᴸ·y − G_s(y,T)]（最有利的析出成分 y*）。对固定 y 它仍是 T 的一次函数 A(y) − T·B(y)，于是交替执行 T ← A(y)/B(y) 与 y ← y*(T)：这正是对 Δ_s(T) = 0 的牛顿迭代（包络定理 dΔ/dT = −B(y*)），收敛时 y* 即与液相共轭的固相成分。</> },
              { kind: 'valid', body: <>正规溶液、ΔCp = 0。化学计量相有闭式解；固溶体需上述迭代（无闭式解）。</> },
            ]}
          />
          <Panel title="本状态的数值" prov="model">
            <KV
              rows={[
                ['x₀', <span className="mono">({x0.map((v) => fmtNum(v, 4)).join(', ')})</span>],
                ['μᴸ(x₀, T)', <span className="mono">({mu.map((v) => fmtNum(v, 2)).join(', ')}) J/mol</span>],
                ['液相线 / 初晶相', <span>{cel(liq.T, 2)} / {d.solids[liq.si].label}</span>],
                ['验证：Δ_s(x₀, T_liq)（应为 0）', <span className="mono">{(() => {
                  return th.drivingForce(liq.si, x0, liq.T).toExponential(2);
                })()} J/mol</span>],
              ]}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
