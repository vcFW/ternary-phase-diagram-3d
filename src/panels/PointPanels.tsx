import { useMemo } from 'react';
import { cel, phaseColor, regionName, toC } from '../core/colors';
import type { Comp } from '../core/types';
import { fmtNum } from '../math/linalg';
import type { PointAnalysis } from '../math/pointAnalysis';
import { useStore } from '../state/store';
import { COLOR } from '../ui/tokens';
import { Derivation, Eq, KV, MatrixView, Prov, type Step } from '../viz/MathView';
import { XYPlot, type Series } from '../viz/XYPlot';

export const pc = (v: number, d = 2) => `${(v * 100).toFixed(d)}`;
export const cstr = (x: Comp, d = 2) => x.map((v) => pc(v, d)).join(' / ');

/**
 * 当前物理状态的分析面板（几何 / 稳定性 / 演化 / 数学推导 / 当前反应）。
 * 它们原先挤在工作台检查器的 8 个标签里；现在各归其分析页（线性代数 · 热力学 · 凝固路径），
 * 检查器只留"推导"并给出跳转链接。同一全局状态，同一份代码。
 */

export function Sec({ title, prov, children }: { title: string; prov?: 'math' | 'model' | 'unknown' | 'assume' | 'demo'; children: React.ReactNode }) {
  return (
    <section className="ins-sec">
      <h4>
        {title} {prov && <Prov k={prov} />}
      </h4>
      {children}
    </section>
  );
}

/** 此刻降温一小步会发生什么（单变 / 不变反应与判据） */
export function ReactionNow({ an }: { an: PointAnalysis }) {
  const r = an.reaction;
  return (
    <>
      <Sec title="此刻降温一小步会发生什么" prov="model">
        <div className="ins-big">
          <b className="mono">{r.text}</b>
          <span className={`kind ${r.type}`}>{{ primary: '初晶析出', eutectic: '共晶型单变反应', peritectic: '转熔（包晶）型单变反应', invariant: '四相不变反应', solid: '固态', none: '无反应' }[r.type]}</span>
        </div>
        <p>{r.explain}</p>
        {r.lambda !== undefined && (
          <p className="small">
            判据：λ ∈ (0, 1) ⇒ 共晶型；λ &lt; 0 或 λ &gt; 1 ⇒ 远离交点的固相被回溶。此处 λ = {fmtNum(r.lambda, 4)}。
          </p>
        )}
      </Sec>
    </>
  );
}

// ===================================================================== 几何与向量
export function GeometryPanel({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      <Sec title="向量" prov="math">
        <table className="grid">
          <thead>
            <tr>
              <th>向量</th>
              <th>笛卡尔分量</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            {an.vectors.map((v, k) => (
              <tr key={k}>
                <td className="mono">{v.label}</td>
                <td className="num">({fmtNum(v.v[0], 3)}, {fmtNum(v.v[1], 3)})</td>
                <td className="small">{v.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">坐标：A = (0, 0)，B = (1, 0)，C = (½, √3/2)。图中箭头只表示方向，长度已归一化。</p>
      </Sec>
      <Sec title="连结线 / 连结三角形" prov="math">
        {an.phases.length === 1 && <p>单相：没有连结线。x₀ 就是该相的成分。</p>}
        {an.phases.length === 2 && <p>两相：x₀、c₁、c₂ 共线（直线规则），f₁ : f₂ = |x₀c₂| : |x₀c₁|（杠杆规则）。共线性残差 = {an.lever.residual.toExponential(2)}。</p>}
        {an.phases.length === 3 && (
          <p>
            三相：x₀ 在连结三角形内，fᵢ = 子三角形面积 / 总面积（重心坐标）。有向面积 S = {fmtNum(an.lever.areas?.total ?? NaN, 5)}，子三角形 = ({an.lever.areas?.sub.map((v) => fmtNum(v, 5)).join(', ')})。
          </p>
        )}
        <p className="small">
          读数线：过 x₀ 作平行于对边的三条直线，与边的交点读出 {sym.map((s, i) => `x_${s} = ${an.x0[i].toFixed(3)}`).join('，')} —— 这是重心坐标的几何读法。
        </p>
      </Sec>
      {an.reaction.curve && (
        <Sec title="液相所在界线的局部几何" prov="model">
          <KV
            rows={[
              ['切向 t（降温方向）', <span className="mono">({fmtNum(an.reaction.curve.frame.tCool[0], 4)}, {fmtNum(an.reaction.curve.frame.tCool[1], 4)})</span>],
              ['dT/ds', <span className="mono">{fmtNum(an.reaction.curve.frame.dTds, 2)} K / 单位弧长</span>],
              ['切线–连线求交 (τ, λ)', <span className="mono">({fmtNum(an.reaction.curve.ti.tau, 4)}, {fmtNum(an.reaction.curve.ti.lambda, 4)})</span>],
              ['共轭固相成分', <span className="mono">{cstr(an.reaction.curve.ya)} | {cstr(an.reaction.curve.yb)}</span>],
            ]}
          />
        </Sec>
      )}
      <Sec title="恒温下移动 x₀ 会越过的相界" prov="model">
        {an.neighbors.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>方向（相对 A→B 边）</th>
                <th>距离</th>
                <th>进入相区</th>
              </tr>
            </thead>
            <tbody>
              {an.neighbors.map((n) => (
                <tr key={n.dir}>
                  <td className="num">{((n.dir * 180) / Math.PI).toFixed(0)}°</td>
                  <td className="num">≤ {n.dist.toFixed(3)}</td>
                  <td>{regionName(n.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">在 0.1 范围内各方向均停留在同一相区。</p>
        )}
        <p className="note">越过相界时相数改变 1（相区接触规则）：例如 L+α → L+α+β 表示新相 β 开始在液相中饱和。</p>
      </Sec>
    </>
  );
}

// ===================================================================== 稳定性
export function StabilityPanel({ an }: { an: PointAnalysis }) {
  const st = an.stability;
  const CLS = { stable: '稳定', metastable: '亚稳', unstable: '不稳定' } as const;
  const mu = st.gm.mu;
  return (
    <>
      <Sec title="平衡解是否为全局最小" prov="model">
        <KV
          rows={[
            ['公切面 μ = (μ_A, μ_B, μ_C)', <span className="mono">({mu.map((v) => fmtNum(v, 1)).join(', ')}) J/mol</span>],
            ['最小切面距离（证书）', <span className={st.certificate > -1e-3 ? 'ok' : 'bad'}>{fmtNum(st.certificate, 4)} J/mol {st.certificate > -1e-3 ? '≥ 0 ⇒ 没有任何相能自发析出：全局稳定' : '< 0 ⇒ 存在可析出相（不是平衡）'}</span>],
            ['G_eq', <span className="mono">{fmtNum(an.eq.G, 3)} J/mol（独立 LP：{fmtNum(st.gm.G, 3)}）</span>],
          ]}
        />
        <table className="grid">
          <thead>
            <tr>
              <th>相</th>
              <th>切面距离 r = min[G − μ·x]</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {st.forces.map((f) => (
              <tr key={f.id + f.si}>
                <td>{f.id}</td>
                <td className="num">{Number.isFinite(f.r) ? fmtNum(f.r, 3) : '+∞'}</td>
                <td className="small">
                  {f.status === 'on-plane' ? '在公切面上（共存相）' : f.status === 'above' ? '在切面之上：析出驱动力为负（不会出现）' : f.status === 'below' ? '在切面之下：有析出驱动力！' : '含缺失组元，不可能出现'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Sec>
      <Sec title="假想的均匀单相状态（成分 x₀）" prov="model">
        <table className="grid">
          <thead>
            <tr>
              <th>相</th>
              <th>G_φ(x₀) − G_eq</th>
              <th>Hessian 特征值</th>
              <th>分类</th>
            </tr>
          </thead>
          <tbody>
            {st.homogeneous.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td className="num">{fmtNum(h.excess, 2)}</td>
                <td className="num">{fmtNum(h.eig[0], 0)}, {fmtNum(h.eig[1], 0)}</td>
                <td className={h.cls === 'stable' ? 'ok' : h.cls === 'unstable' ? 'bad' : ''}>{CLS[h.cls]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {st.homogeneous[0]?.maxDF && st.homogeneous[0].maxDF.df > 0 && (
          <p>
            若液相保持均匀（过冷），对 <b>{st.homogeneous[0].maxDF.id}</b> 的析出驱动力最大：Δ = {fmtNum(st.homogeneous[0].maxDF.df, 1)} J/mol —— 这是形核的热力学驱动力（但能否形核还取决于界面能等动力学因素，本模型不包含）。
          </p>
        )}
        <p className="small">
          判据：<b>稳定</b> = 吉布斯能等于全局最小；<b>亚稳</b> = 高于最小值但 Hessian 正定（对任意小的成分涨落稳定，需形核越过能垒）；<b>不稳定</b> = Hessian 有非正特征值（旋节分解，任意小涨落都会长大）。
        </p>
        <p className="note">
          <Prov k="assume" /> 结论依赖热力学模型（示意参数）。若没有可靠的 G 数据，只能由几何给出相分数与守恒关系，稳定性<b>无法判定</b>。
        </p>
      </Sec>
    </>
  );
}

// ===================================================================== 数学推导
export function DerivationPanel({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  const lv = an.lever;
  const names = an.phases.map((p) => p.id);
  const steps: Step[] = [
    { kind: 'known', body: <>x₀ = ({an.x0.map((v) => fmtNum(v, 4)).join(', ')})，T = {cel(an.T, 2)}；热力学模型给出各相 G_φ(x, T)。</> },
    {
      kind: 'govern',
      title: '吉布斯能最小化',
      body: (
        <Eq>
          min Σ f_φ G_φ(c_φ, T)　s.t.　Σ f_φ c_φ = x₀,　f_φ ≥ 0
        </Eq>
      ),
    },
    { kind: 'mid', title: '最优性（KKT）', body: <>共存相化学势相等 μ_φ(c_φ) = μ（公切面）；其余相切面距离 ≥ 0。本点证书 = {fmtNum(an.stability.certificate, 4)} J/mol。</> },
    {
      kind: 'op',
      title: '相分数：约束线性方程组',
      body: (
        <>
          <MatrixView name="[A | b]" M={lv.A.map((row, i) => [...row, lv.b[i]])} rowLabels={[`x_${sym[0]}`, `x_${sym[1]}`, 'Σ']} colLabels={[...names, 'x₀']} aug={names.length} digits={4} />
          <span className="small">
            rank A = {lv.rank}{lv.det !== null ? `，det A = ${fmtNum(lv.det, 5)}` : ''}，κ(A) = {Number.isFinite(lv.cond) ? fmtNum(lv.cond, 3) : '∞'}；残差 {Number.isFinite(lv.residual) ? lv.residual.toExponential(2) : '—'}
          </span>
        </>
      ),
    },
    { kind: 'result', body: <span className="mono">f = ({lv.f?.map((v) => fmtNum(v, 5)).join(', ') ?? '—'})</span> },
    {
      kind: 'mid',
      title: 'Gibbs 相律 = 秩–零化度',
      body: (
        <>
          <MatrixView name="G" M={an.gd.G} rowLabels={names} colLabels={['S', 'x_A', 'x_B', 'x_C']} digits={3} />
          <span className="small">每行为一个相的 Gibbs–Duhem 方程 S dT + Σ xᵢ dμᵢ = 0；F = 4 − rank = {an.gd.F}。</span>
        </>
      ),
    },
    ...(an.sens.valid
      ? [
          {
            kind: 'op' as const,
            title: '成分灵敏度 ∂f/∂x₀',
            body: (
              <>
                <MatrixView name="∂f/∂(x_A, x_B)" M={an.sens.M} rowLabels={names} colLabels={['∂x_A', '∂x_B']} digits={3} />
                <span className="small">{an.sens.note}</span>
              </>
            ),
          },
        ]
      : [{ kind: 'phys' as const, body: <>{an.sens.note}</> }]),
    { kind: 'valid', body: <>封闭体系、恒压、平衡；相分数非负是物理约束（越界即说明相组合错误）。G 模型为示意参数。</> },
  ];
  return <Derivation title="此点的完整数学描述" steps={steps} initial="all" />;
}

// ===================================================================== 演化
export function EvolutionPanel({ an }: { an: PointAnalysis }) {
  const history = useStore((s) => s.history);
  const d = useStore((s) => s.diagram);
  const mode = useStore((s) => s.mode);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const ids = useMemo(() => Array.from(new Set(trace.samples.flatMap((s) => s.eq.phases.map((p) => p.id)))), [trace]);
  const S = trace.samples;
  const cur = S[Math.min(S.length - 1, Math.round(idx))];
  if (mode === 'cooling') {
    const fs: Series[] = ids.map((id) => ({
      id,
      pts: S.filter((s) => s.xi < 0).map((s) => [toC(s.T), s.eq.phases.find((p) => p.id === id)?.frac ?? 0] as [number, number]),
      color: id === 'L' ? COLOR.phase.liquid : phaseColor(d, id),
      label: id,
    }));
    const gs: Series[] = [{ id: 'G', pts: S.filter((s) => s.xi < 0).map((s) => [toC(s.T), s.eq.G / 1000] as [number, number]), color: COLOR.ink, label: 'G_eq(T)' }];
    // 当前温度的 df/dT（有限差分）
    const k = Math.min(S.length - 2, Math.max(0, Math.round(idx)));
    const a = S[k];
    const b = S[k + 1];
    const dT = a && b ? a.T - b.T : 0;
    return (
      <>
        <Sec title="冷却：x₀ 固定，温度为唯一变量" prov="model">
          <p className="small">
            封闭体系的总成分不随时间变化 —— 图中红色 x₀ 保持不动；移动的是液相成分 x_L（蓝色）与相分数。质量守恒在每一时刻都成立：Σ fᵢ cᵢ = x₀。
          </p>
          <XYPlot height={170} series={fs} ylim={[0, 1]} xlim={[toC(S[0].T), toC(S[S.length - 1].T)]} xlabel="T / °C（向右降温）" ylabel="相分数" vlines={[{ x: toC(cur.T), color: COLOR.stateX0, dash: '' }]} />
          <XYPlot height={140} series={gs} xlim={[toC(S[0].T), toC(S[S.length - 1].T)]} ylabel="G / kJ" legend={false} vlines={[{ x: toC(cur.T), color: COLOR.stateX0, dash: '' }]} />
        </Sec>
        {a && b && dT > 1e-6 && a.eq.key === b.eq.key && (
          <Sec title="此刻的变化率（降温 1 K）" prov="model">
            <table className="grid">
              <thead>
                <tr>
                  <th>相</th>
                  <th>−df/dT</th>
                  <th>含义</th>
                </tr>
              </thead>
              <tbody>
                {b.eq.phases.map((p) => {
                  const fa = a.eq.phases.find((q) => q.id === p.id)?.frac ?? 0;
                  const rate = (p.frac - fa) / dT;
                  return (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td className="num">{fmtNum(rate, 5)} /K</td>
                      <td className="small">{rate > 0 ? '增加（析出）' : rate < 0 ? (p.si < 0 ? '液相减少' : '减少（被回溶）') : '不变'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Sec>
        )}
      </>
    );
  }
  const n = history.length;
  const last = n >= 2 ? history[n - 1] : null;
  const prev = n >= 2 ? history[n - 2] : null;
  const dx: number[] | null = last && prev ? [0, 1, 2].map((i) => last.x[i] - prev.x[i]) : null;
  const pred = dx && an.sens.valid ? an.sens.M.map((r) => r[0] * dx[0] + r[1] * dx[1]) : null;
  const gs: Series[] = [{ id: 'G', pts: history.map((h, i) => [i, h.G / 1000] as [number, number]), color: COLOR.ink, label: 'G_eq（拖动序列）' }];
  return (
    <>
      <Sec title="成分探索：T 固定，x₀ 为变量" prov="model">
        <p className="small">拖动 x₀ 时温度不变；相组合、相分数与 G_eq 随 x₀ 变化。G_eq(x₀) 是下凸包本身，因此它是 x₀ 的凸函数。</p>
        {n > 1 ? <XYPlot height={150} series={gs} xlabel="拖动步" ylabel="G_eq / kJ" legend={false} /> : <p className="dim">在左图中拖动 x₀ 以生成轨迹。</p>}
      </Sec>
      {dx && (
        <Sec title="最近一步：Δx₀ 与相分数响应" prov="math">
          <KV
            rows={[
              ['Δx₀', <span className="mono">({dx.map((v) => fmtNum(v, 4)).join(', ')})</span>],
              ['实际 Δf', <span className="mono">{Object.keys(last!.f).map((k) => `${k}: ${fmtNum((last!.f[k] ?? 0) - (prev!.f[k] ?? 0), 4)}`).join('，')}</span>],
              ['线性预测 (∂f/∂x₀)·Δx₀', <span className="mono">{pred ? an.phases.map((p, i) => `${p.id}: ${fmtNum(pred[i], 4)}`).join('，') : an.sens.note}</span>],
            ]}
          />
        </Sec>
      )}
    </>
  );
}
