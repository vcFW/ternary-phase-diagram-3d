import { useMemo, useState } from 'react';
import { toXY } from '../../core/barycentric';
import { cel, solidColor } from '../../core/colors';
import type { Comp } from '../../core/types';
import { phaseFractions } from '../../math/lever';
import { fmtNum } from '../../math/linalg';
import { analyzeReaction } from '../../math/reaction';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Arrow, Handle, TernaryPlot, type TriMap } from '../../viz/TernaryPlot';
import { Eq, KV, M, Panel, Prov } from '../../viz/MathView';
import { Segmented } from '../../ui/controls';
import { Layers5 } from './RulesPage';
import { COLOR } from '../../ui/tokens';

const PT = (m: TriMap, x: Comp) => m.px(x);

// ===================================================================== 杠杆规则
export function LeverRule() {
  const d = useStore((s) => s.diagram);
  const [a, setA] = useState<Comp>([0.75, 0.15, 0.1]);
  const [b, setB] = useState<Comp>([0.15, 0.35, 0.5]);
  const [c, setC] = useState<Comp>([0.45, 0.25, 0.3]);
  const [snap, setSnap] = useState(true);
  // 吸附到连结线上（便于观察正例）；关闭后可拖离做反例
  const onC = (x: Comp) => {
    if (!snap) return setC(x);
    const A = toXY(a);
    const B = toXY(b);
    const P = toXY(x);
    const t = ((P[0] - A[0]) * (B[0] - A[0]) + (P[1] - A[1]) * (B[1] - A[1])) / ((B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2);
    setC([0, 1, 2].map((i) => a[i] + t * (b[i] - a[i])) as Comp);
  };
  const r = phaseFractions([a, b], c);
  const A = toXY(a);
  const B = toXY(b);
  const P = toXY(c);
  const dA = Math.hypot(P[0] - A[0], P[1] - A[1]);
  const dB = Math.hypot(P[0] - B[0], P[1] - B[1]);
  return (
    <>
      <PageTitle title="直线规则与杠杆规则" desc="两相平衡：总成分点必在两相成分点的连线上，且相对量与线段长度成反比。" />
      <div className="cols c2">
        <Panel title="交互：拖动 α、β 与总成分 c₀" prov="math" right={<Segmented size="sm" value={snap ? 1 : 0} onChange={(v) => setSnap(!!v)} options={[{ value: 1, label: 'c₀ 吸附连线' }, { value: 0, label: '自由（反例）' }]} />}>
          <div className="plot-box tall">
            <TernaryPlot d={d} background="none" boundaries={false} invariants={false} solids={false}>
              {(m) => {
                const pa = PT(m, a);
                const pb = PT(m, b);
                // 延长线
                const ext = (t: number) => m.px([0, 1, 2].map((i) => a[i] + t * (b[i] - a[i])) as Comp);
                const e0 = ext(-3);
                const e1 = ext(4);
                return (
                  <>
                    <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} className="lnk dash" opacity={0.4} />
                    <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} className={`lnk ${r.status !== 'ok' ? 'hi' : ''}`} strokeWidth={2} />
                    <Handle m={m} x={a} onDrag={setA} color="#d95319" label={`α  f=${r.f ? fmtNum(r.f[0], 3) : '—'}`} />
                    <Handle m={m} x={b} onDrag={setB} color={COLOR.accent} label={`β  f=${r.f ? fmtNum(r.f[1], 3) : '—'}`} />
                    <Handle m={m} x={c} onDrag={onC} color="#c00000" label="c₀" />
                  </>
                );
              }}
            </TernaryPlot>
          </div>
          <KV
            rows={[
              ['相容性残差（c₀ 到连线的偏离）', <span className="mono">{r.residual.toExponential(2)}</span>],
              ['f_α, f_β（最小二乘）', <span className="mono">{r.f?.map((v) => fmtNum(v, 4)).join(', ')}</span>],
              ['|c₀β| / |αβ|（几何）', <span className="mono">{fmtNum(dB / (dA + dB), 4)}</span>],
              ['判定', <span className={r.status === 'ok' ? 'ok' : 'bad'}>{r.message}</span>],
            ]}
          />
        </Panel>
        <Layers5
          def={
            <>
              <p>体系由 α、β 两相组成，相成分 c_α、c_β 已知，总成分 c₀。则 c₀ 在直线 αβ 上（直线规则），且 f_α : f_β = |c₀β| : |c₀α|（杠杆规则）。</p>
              <p className="note">
                <Prov k="assume" /> 封闭体系；成分与相分数用同一种基准（摩尔或质量）；两相成分已知。
              </p>
            </>
          }
          geo={<p>c₀ 是 c_α、c_β 的凸组合：线段上的点 ↔ 权重在 [0,1] 内；延长线上的点 ↔ 某个权重为负。</p>}
          math={
            <>
              <Eq>f_α c_α + f_β c_β = c₀,　f_α + f_β = 1</Eq>
              <p>
                消去 f_β：<M>c₀ − c_β = f_α (c_α − c_β)</M>。左边向量与 (c_α − c_β) 平行 ⇒ 三点共线（直线规则）；取模长 ⇒
                <M> f_α = |c₀ − c_β| / |c_α − c_β|</M>（杠杆规则）。矩阵形式下 A 为 3×2，b ∈ col(A) ⇔ 共线；否则最小二乘残差 &gt; 0。
              </p>
            </>
          }
          phys={<p>纯粹是原子守恒：每种原子的总量 = 各相中该原子量之和。不涉及任何热力学 —— 因此它对任何两相平衡（甚至非平衡的两相混合物）都成立。</p>}
          verify={
            <>
              <p>• 关闭吸附并把 c₀ 拖离直线：方程不相容，残差 ≠ 0 —— 这两相不可能组成该总成分。</p>
              <p>• 把 c₀ 拖到延长线上：解存在但 f &lt; 0，物理不可行。</p>
              <div className="callout warn">
                <b>局限：</b>杠杆规则只"使用"连结线，不"决定"连结线。三元两相区（如 L + 固溶体）中，过 c₀ 的连结线方向需由热力学（化学势相等）或实验确定；
                几何本身给不出来。化学计量体系中连结线总是指向固相点，这是模型假设而非几何定理；切换到"固溶体"体系即可看到连结线方向随成分、温度变化（三元匀晶有 Rachford–Rice 解析解，见验证算例 9）。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}

// ===================================================================== 重心规则
export function GravityRule() {
  const d = useStore((s) => s.diagram);
  const [p, setP] = useState<Comp[]>([
    [0.8, 0.1, 0.1],
    [0.1, 0.8, 0.1],
    [0.15, 0.15, 0.7],
  ]);
  const [L, setL] = useState<Comp>([0.35, 0.33, 0.32]);
  const r = phaseFractions(p, L);
  const rx = analyzeReaction([{ label: 'L', x: L, si: -1 }, ...p.map((x, i) => ({ label: 'αβγ'[i], x, si: i }))]);
  const pos = !r.f ? '—' : r.f.every((v) => v > 1e-9) ? '重心位（三角形内）' : r.f.filter((v) => v < -1e-9).length === 1 ? '交叉位（越过一条边）' : '共轭位（越过一个顶角）';
  const names = ['α', 'β', 'γ'];
  return (
    <>
      <PageTitle title="重心规则（三角形规则）" desc="三相平衡：总成分 = 三个相成分点的重心坐标组合；液相点相对固相三角形的位置决定不变反应类型。" />
      <div className="cols c2">
        <Panel title="交互：拖动三个相点与点 P" prov="math" sub="7 个符号区域由三角形三边的延长线划分">
          <div className="plot-box tall">
            <TernaryPlot d={d} background="none" boundaries={false} invariants={false} solids={false}>
              {(m) => {
                const V = p.map((x) => m.px(x));
                const ext = (i: number, j: number) => {
                  const a = p[i];
                  const b = p[j];
                  const e0 = m.px([0, 1, 2].map((k) => a[k] + -4 * (b[k] - a[k])) as Comp);
                  const e1 = m.px([0, 1, 2].map((k) => a[k] + 5 * (b[k] - a[k])) as Comp);
                  return <line key={`${i}${j}`} x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} className="lnk dash" opacity={0.35} />;
                };
                return (
                  <>
                    {ext(0, 1)}
                    {ext(1, 2)}
                    {ext(2, 0)}
                    <polygon points={V.map((v) => v.join(',')).join(' ')} className={`tri-fill ${r.status === 'outside' ? 'bad' : ''}`} />
                    {p.map((x, i) => (
                      <Handle key={i} m={m} x={x} color={solidColor(i)} label={`${names[i]}  λ=${r.f ? fmtNum(r.f[i], 3) : '—'}`} onDrag={(y) => setP((q) => q.map((z, k) => (k === i ? y : z)))} />
                    ))}
                    <Handle m={m} x={L} onDrag={setL} label="P" />
                  </>
                );
              }}
            </TernaryPlot>
          </div>
          <KV
            rows={[
              ['重心坐标 λ = A⁻¹b', <span className="mono">({r.f?.map((v) => fmtNum(v, 4)).join(', ')})</span>],
              ['符号模式', <span className="mono">({r.f?.map((v) => (v > 1e-9 ? '+' : v < -1e-9 ? '−' : '0')).join(', ')})</span>],
              ['位置', <b>{pos}</b>],
              ['若 P 为液相：反应（ν_L = −1）', <span className="mono">{rx.text}</span>],
              ['反应类型', <span>{rx.message}</span>],
            ]}
          />
        </Panel>
        <Layers5
          def={
            <>
              <p>三相 α、β、γ 平衡共存时，总成分点 P 必落在三相成分点构成的三角形内，各相分数 = P 的重心坐标（"重心规则"）。</p>
              <p>推广（用于不变点）：把液相看成 P，λ 的符号模式给出三种相对位置 —— 重心位、交叉位、共轭位。</p>
            </>
          }
          geo={<p>三条边的延长线把平面分成 7 个区域，每个区域对应 λ 的一种符号模式：(+,+,+) 1 个，(+,+,−) 型 3 个，(+,−,−) 型 3 个。不存在 (−,−,−)，因为 Σλ = 1。</p>}
          math={
            <>
              <Eq>λ = A⁻¹ b,　A = [[c_iA], [c_iB], [1, 1, 1]],　λᵢ = Sᵢ / S</Eq>
              <p>Cramer 法则把每个 λᵢ 写成"把第 i 个顶点换成 P 后的有向面积"与总面积之比。P 越过与顶点 i 相对的边 ⇔ 子三角形翻转 ⇔ λᵢ 变号。</p>
            </>
          }
          phys={
            <>
              <p>作为相分数：λ ≥ 0 是物理约束。作为不变反应系数：液相点 x_L = Σ νₛ cₛ（ν 即 λ），νₛ &gt; 0 的固相在降温时析出，νₛ &lt; 0 的固相被回溶。</p>
              <p>重心位 → L → α + β + γ（共晶）；交叉位 → L + α → β + γ（过渡点）；共轭位 → L + α + β → γ（双转熔）。</p>
            </>
          }
          verify={
            <>
              <p>• 拖动 P 越过一条边：恰有一个 λ 变号，反应类型由共晶变为过渡点。</p>
              <p>• 把三个相点拖成近似共线：det A → 0，λ 爆炸（病态），见"数学实验与验证 · 退化与病态"。</p>
              <p className="note">
                <Prov k="math" /> 位置分类是纯几何结论；但"该四相组合是否真的平衡共存、反应朝哪个方向进行"需要热力学（见"不变点与反应分类"）。
              </p>
            </>
          }
        />
      </div>
    </>
  );
}

// ===================================================================== 等比例规则与背向线规则
export function RatioRule() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const trace = useStore((s) => s.trace);
  const [v, setV] = useState<0 | 1 | 2>(2);
  const sym = d.params.components.map((c) => c.symbol);
  const j = ((v + 1) % 3) as 0 | 1 | 2;
  const k = ((v + 2) % 3) as 0 | 1 | 2;
  // 初晶阶段：液相点与初晶固相、x₀ 共线的残差（模型冷却数据）
  const primary = useMemo(() => {
    const smp = trace.samples.filter((s) => s.eq.phases.length === 2 && s.eq.phases.some((p) => p.si < 0));
    if (!smp.length) return null;
    const sol = smp[0].eq.phases.find((p) => p.si >= 0)!;
    let worst = 0;
    const P0 = toXY(x0);
    const PS = toXY(sol.x);
    const pts: Comp[] = [];
    for (const s of smp) {
      if (s.eq.key !== smp[0].eq.key) continue;
      const L = s.eq.phases.find((p) => p.si < 0)!;
      const PL = toXY(L.x);
      worst = Math.max(worst, Math.abs((P0[0] - PS[0]) * (PL[1] - PS[1]) - (P0[1] - PS[1]) * (PL[0] - PS[0])));
      pts.push(L.x);
    }
    return { sol, worst, pts, Tfrom: smp[0].T };
  }, [trace, x0]);
  return (
    <>
      <PageTitle title="等比例规则与背向线规则" desc="过顶点的直线上另两组元之比不变；初晶析出时液相沿「固相点 → 总成分点」射线背离固相移动。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="等比例规则：过顶点的直线" prov="math" right={<Segmented size="sm" value={v} onChange={setV} options={sym.map((s, i) => ({ value: i as 0 | 1 | 2, label: `过 ${s}` }))} />}>
            <div className="plot-box">
              <TernaryPlot d={d} background="none" boundaries={false} invariants={false} solids={false} onPick={(x) => setX0(x)}>
                {(m) => {
                  const V = m.px(((): Comp => { const c: Comp = [0, 0, 0]; c[v] = 1; return c; })());
                  const s = x0[j] + x0[k] || 1;
                  const foot: Comp = [0, 0, 0];
                  foot[j] = x0[j] / s;
                  foot[k] = x0[k] / s;
                  const F = m.px(foot);
                  const ticks = [0.2, 0.4, 0.6, 0.8].map((t) => {
                    const q: Comp = [0, 0, 0];
                    q[v] = t;
                    q[j] = (1 - t) * foot[j];
                    q[k] = (1 - t) * foot[k];
                    return { t, p: m.px(q), q };
                  });
                  return (
                    <>
                      <line x1={V[0]} y1={V[1]} x2={F[0]} y2={F[1]} className="lnk hi" />
                      {ticks.map((tk) => (
                        <g key={tk.t}>
                          <circle cx={tk.p[0]} cy={tk.p[1]} r={3} fill={COLOR.accent} />
                          <text x={tk.p[0] + 6} y={tk.p[1] + 3} className="pt-lab" fill={COLOR.accent}>
                            {sym[j]}:{sym[k]} = {fmtNum(tk.q[j] / (tk.q[k] || 1e-12), 3)}
                          </text>
                        </g>
                      ))}
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x)} label="x₀" />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <Eq>
              x(t) = (1 − t)·e_{sym[v]} + t·x₀ ⇒ x_{sym[j]}(t) / x_{sym[k]}(t) = x₀_{sym[j]} / x₀_{sym[k]} = {fmtNum(x0[j] / (x0[k] || 1e-12), 4)}
            </Eq>
            <p>
              线性代数形式：该直线 = {'{'}x : x₀_{sym[k]}·x_{sym[j]} − x₀_{sym[j]}·x_{sym[k]} = 0{'}'} ∩ {'{'}Σx = 1{'}'}，即 1×3 行向量的零空间与约束平面之交。
              向体系加入（或析出）纯组元 {sym[v]} 时，成分点只能沿这条直线移动。
            </p>
          </Panel>
          <Panel title="背向线规则：初晶阶段的液相路径" prov="model" sub="使用全局状态的平衡冷却数据">
            <div className="plot-box">
              <TernaryPlot d={d} background="fields" onPick={(x) => setX0(x, false)}>
                {(m) => {
                  if (!primary) return <Handle m={m} x={x0} onDrag={(x) => setX0(x, false)} />;
                  const S = m.px(primary.sol.x);
                  const P0 = m.px(x0);
                  const last = m.px(primary.pts[primary.pts.length - 1]);
                  return (
                    <>
                      <line x1={S[0]} y1={S[1]} x2={last[0]} y2={last[1]} className="lnk dash" />
                      <polyline points={primary.pts.map((x) => m.px(x).join(',')).join(' ')} fill="none" stroke="#7e2f8e" strokeWidth={3} />
                      <Arrow p={P0} q={last} cls="tan" />
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x, false)} label="x₀" />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            {primary ? (
              <KV
                rows={[
                  ['初晶相', <>{primary.sol.id}，自 {cel(primary.Tfrom, 1)} 起</>],
                  ['液相点与 {首个析出固相点, x₀} 共线的最大偏差', primary.worst < 1e-9 ? <span className="mono">{primary.worst.toExponential(2)}（数值零）</span> : <span className="bad">{primary.worst.toExponential(2)} —— 固溶体：析出相成分随温度变化，路径弯曲，背向线规则不成立</span>],
                ]}
              />
            ) : (
              <p className="dim">该成分没有初晶阶段（例如恰在界线上）。</p>
            )}
          </Panel>
        </div>
        <Layers5
          def={
            <>
              <p><b>等比例规则：</b>过三角形某顶点的直线上，另两组元含量之比恒定。</p>
              <p><b>背向线规则：</b>从液相中只析出一种成分固定的固相 S 时，液相成分沿 S→x₀ 方向的延长线、背离 S 移动。</p>
              <p className="note"><Prov k="assume" /> 背向规则要求析出相成分固定（化学计量相）且体系封闭。</p>
            </>
          }
          geo={<p>两条规则说的是同一件事：向混合物中加入或移走某一固定成分的物质，成分点沿着通过该成分点的直线移动。</p>}
          math={
            <>
              <Eq>x₀ = f_s x_s + (1 − f_s) x_L ⇒ x_L = (x₀ − f_s x_s) / (1 − f_s)</Eq>
              <p>
                对 f_s 求导：<M>dx_L/df_s = (x_L − x_s)/(1 − f_s)</M>。方向向量始终平行于 x_L − x_s，且 x_L 不断远离 x_s ⇒ 路径为直线射线。
                f_s 由温度决定（模型的饱和条件），而路径的<b>形状</b>只由守恒决定。
              </p>
            </>
          }
          phys={<p>"直线"来自守恒，"走多远"来自热力学。所以二维投影图上即使不知道温度，也能画出初晶阶段的路径 —— 这是投影图上少数不需要温度信息的结论之一。</p>}
          verify={
            <>
              {d.sol ? <p>• 当前为固溶体体系：液相路径（紫色）偏离虚线 —— 析出的 α 成分随温度变化，背向线规则<b>不成立</b>（偏差见左表）。</p> : <p>• 上图中液相路径（紫色）与虚线完全重合，偏差为机器精度。</p>}
              <div className="callout warn">
                <b>反例：</b>若析出相是成分随温度变化的固溶体，则 dx_L/df ∝ (x_L − x_s(T)) 方向不断改变，液相路径弯曲（"背向线"失效）。
                在顶部切换到"有限固溶度三元共晶"即可在上图中直接看到：液相路径偏离虚线（验证算例 10 量化了转角）。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}
