import { useMemo, useState } from 'react';
import { cel, toC } from '../../core/colors';
import type { PhaseDiagram } from '../../core/diagram';
import { alkemadeCheck, analyzeCurveAt } from '../../math/curves';
import { fmtNum } from '../../math/linalg';
import { parametrize } from '../../math/spaces';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Arrow, TernaryPlot } from '../../viz/TernaryPlot';
import { XYPlot } from '../../viz/XYPlot';
import { KV, MatrixView, Panel, Prov } from '../../viz/MathView';
import { LocalParam } from '../../ui/LocalParam';
import { Layers5 } from './RulesPage';
import { COLOR } from '../../ui/tokens';
import { TeXBlock, TeX } from '../../viz/TeX';

function CurvePicker({ d, ci, setCi }: { d: PhaseDiagram; ci: number; setCi: (i: number) => void }) {
  return (
    <select value={ci} onChange={(e) => setCi(Number(e.target.value))}>
      {d.topo.curves.map((c, k) => (
        <option key={c.id} value={k}>
          {d.solids[c.a].label}/{d.solids[c.b].label} 界线
        </option>
      ))}
    </select>
  );
}

function useCurve(defaultPick?: (d: PhaseDiagram) => number) {
  const d = useStore((s) => s.diagram);
  const [pick, setPick] = useState<{ uid: number; ci: number } | null>(null);
  const ci = pick && pick.uid === d.uid ? pick.ci : Math.max(0, defaultPick ? defaultPick(d) : 0);
  const cv = d.topo.curves[Math.min(ci, d.topo.curves.length - 1)];
  return { d, ci, cv, setCi: (i: number) => setPick({ uid: d.uid, ci: i }) };
}

// ===================================================================== Alkemade
export function AlkemadeRule() {
  const { d, ci, cv, setCi } = useCurve((dd) => dd.topo.curves.findIndex((c) => alkemadeCheck(dd, c).sCross !== null));
  const ak = useMemo(() => (cv ? alkemadeCheck(d, cv) : null), [d, cv]);
  const cp = useMemo(() => (cv ? parametrize(cv) : null), [cv]);
  const [sFrac, setSFrac] = useState<number | null>(null);
  if (!cv || !cp || !ak) return <p className="dim">该体系没有界线。</p>;
  const s = sFrac === null ? (ak.sCross ?? cp.length / 2) : sFrac * cp.length;
  const an = analyzeCurveAt(d, cv, s);
  const a = d.solids[cv.a];
  const b = d.solids[cv.b];
  const v = an.gd.nullBasis[0];
  return (
    <>
      <PageTitle title="连线规则 · Alkemade 定理" desc="界线与两初晶相成分点连线（或其延长线）的交点是该界线上的温度极大点；温度沿界线背离交点下降。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="界线、连线与温度剖面" prov="model" right={<CurvePicker d={d} ci={ci} setCi={setCi} />}>
            <div className="plot-box">
              <TernaryPlot d={d} background="fields" minHeight={280}>
                {(m) => {
                  // 连线端点 = 该点处与液相共轭的固相成分（化学计量相即固定成分点）
                  const A = m.px(an.ya);
                  const B = m.px(an.yb);
                  const ext = (t: number) => m.px([0, 1, 2].map((i) => an.ya[i] + t * (an.yb[i] - an.ya[i])) as [number, number, number]);
                  const e0 = ext(-1.5);
                  const e1 = ext(2.5);
                  const p = m.px(an.frame.x);
                  return (
                    <>
                      <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} className="lnk dash" opacity={0.5} />
                      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={COLOR.accent} strokeWidth={2} />
                      <polyline points={cv.pts.map((x) => m.px(x).join(',')).join(' ')} fill="none" stroke={COLOR.stateX0} strokeWidth={3} opacity={0.6} />
                      <circle cx={p[0]} cy={p[1]} r={4.5} fill={COLOR.path} />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <XYPlot
              height={180}
              series={[{ id: 'T', pts: cp.s.map((v2, k) => [v2, toC(cp.T[k])] as [number, number]), color: COLOR.ink, label: 'T(s)' }]}
              xlabel="界线弧长 s"
              ylabel="T / °C"
              vlines={[
                ...(ak.sCross !== null ? [{ x: ak.sCross, color: COLOR.accent, label: '与连线相交' }] : []),
                ...(ak.sMax !== null ? [{ x: ak.sMax, color: COLOR.stateX0, label: '温度极大', dash: '2 2' }] : []),
              ]}
              points={[{ x: s, y: toC(an.frame.T), color: COLOR.path }]}
              onPick={(x) => setSFrac(Math.max(0, Math.min(1, x / cp.length)))}
            />
            <LocalParam label="位置 s/L" labelWidth={70} value={s / cp.length} min={0} max={1} step={0.002} digits={3} onChange={setSFrac} />
            <KV
              rows={[
                ['交点弧长 / 温度', <span className="mono">{ak.sCross !== null ? `${fmtNum(ak.sCross, 5)} / ${cel(ak.TCross!, 3)}` : '界线范围内无交点'}</span>],
                ['温度极大点弧长 / 温度', <span className="mono">{ak.sMax !== null ? `${fmtNum(ak.sMax, 5)} / ${cel(ak.TMax!, 3)}` : '界线上无内部极大（单调）'}</span>],
                ['交点处 Gibbs–Duhem 零空间的 dT 分量', <span className="mono">{ak.dTatCross !== null ? ak.dTatCross.toExponential(2) : '—'}</span>],
              ]}
            />
            {d.sol && (
              <div className="callout warn">
                固溶体体系：蓝色连线的端点是该点处与液相共轭的 {a.label}、{b.label} 实际成分（随位置变化），而不是名义成分点。
                Alkemade 定理的一般形式是"液相点落在共轭固相连结线上时 dT = 0"；本体系的界线均为单调下降（无内部极大），用名义顶点连线判断会得出错误结论。
              </div>
            )}
          </Panel>
          <Panel title="当前点的 Gibbs–Duhem 方程组" prov="model">
            <MatrixView name="G" M={an.gd.G} rowLabels={['L', a.label, b.label]} colLabels={['S', 'x_A', 'x_B', 'x_C']} digits={4} />
            <p>
              rank G = {an.gd.rank}，零空间维数 F = 4 − rank = {an.gd.F}（单变平衡）。零空间向量 (dT, dμ_A, dμ_B, dμ_C) ∝ (
              {v ? v.map((u) => fmtNum(u, 4)).join(', ') : '—'})；dT / |dμ| = {fmtNum(an.dTrel, 5)}。
            </p>
            <p className="note">熵 S 以纯固相组元为基准：液相 S_L = −∂G_L/∂T，化合物 S = ΔS_f（本模型为 0）。</p>
          </Panel>
        </div>
        <Layers5
          def={
            <>
              <p>若界线（单变线）L + α + β 与连线 αβ（Alkemade 线）相交，则交点是界线上的温度极大点；若不相交，温度沿界线朝背离连线（延长线交点）的方向单调下降。</p>
              <p className="note"><Prov k="assume" /> 恒压；熔化熵不为零；α、β 若为固溶体，"连线"指与液相共轭的实际成分连线。</p>
            </>
          }
          geo={<p>三维中界线是一条空间曲线；它与竖直平面"过 α、β 的连线"相交处，三维曲线达到最高点 —— 该处液相 L 可以由 α、β 按一定比例直接熔成，体系退化为"拟二元"共晶（或包晶）。</p>}
          math={
            <>
              <p>三相共存时每相满足 Gibbs–Duhem：</p>
              <TeXBlock>{String.raw`S^{\varphi}\,dT + \sum_i x_i^{\varphi}\,d\mu_i = 0,\quad \varphi = L,\alpha,\beta`}</TeXBlock>
              <p>写成 G·(dT, dμ)ᵀ = 0。若 x_L = (1−λ)x_α + λx_β，则</p>
              <TeXBlock>{String.raw`\mathrm{row}_L - (1-\lambda)\,\mathrm{row}_\alpha - \lambda\,\mathrm{row}_\beta = [\Delta S, 0, 0, 0]`}</TeXBlock>
              <p>其中 <TeX>{String.raw`\Delta S = S_L - (1-\lambda)S_\alpha - \lambda S_\beta`}</TeX> 为该拟二元熔化熵（&gt; 0）。于是 ΔS·dT = 0 ⇒ <b>dT = 0</b>：交点处温度对界线弧长的导数为零。再由该点两侧液相分别位于连线两侧、反应方向相反可知它是极大。</p>
            </>
          }
          phys={<p>极大点是"α 与 β 一同熔化成同成分液相"的温度；离开它，液相必须偏离连线，任何偏离都需要更低温度才能与 α、β 同时平衡。这是一个纯粹由线性相关性导出的热力学结论。</p>}
          verify={
            <>
              <p>• 选择"对照：一致熔融二元化合物"的 D/C 界线：交点与极大点重合（数值上 ≈ 10⁻⁸ 量级，见验证算例 6，包括破坏对称性的 Ω）。</p>
              <p>• 交点处 Gibbs–Duhem 零空间的 dT 分量为机器零；移动到别处则不为零。</p>
              <div className="callout warn">
                <b>适用条件与反例：</b>①若 α 或 β 有显著固溶度，"连线"应改为实际共存相的连结线，而它随温度变化 —— 用名义化学式画 Alkemade 线会得到错误的极大点位置。
                ②不一致熔融化合物的连线可能只与界线的延长线相交：此时界线上无极大，温度单调（例如 A/D 转熔线）。③若 ΔS ≈ 0（熔化熵近零），dT 不被约束，定理退化。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}

// ===================================================================== 切线规则
export function TangentRule() {
  const { d, ci, cv, setCi } = useCurve((dd) => {
    const k = dd.topo.curves.findIndex((c) => c.pieces.some((p) => p.kind === 'peritectic'));
    return k >= 0 ? k : 0;
  });
  const cp = useMemo(() => (cv ? parametrize(cv) : null), [cv]);
  const [sFrac, setSFrac] = useState(0.5);
  const scan = useMemo(() => {
    if (!cv || !cp) return [];
    const out: [number, number][] = [];
    const n = 80;
    for (let k = 2; k <= n - 2; k++) {
      const s = (cp.length * k) / n;
      const r = analyzeCurveAt(d, cv, s);
      out.push([s, Math.max(-1.5, Math.min(2.5, r.ti.lambda))]);
    }
    return out;
  }, [d, cv, cp]);
  if (!cv || !cp) return <p className="dim">该体系没有界线。</p>;
  const s = sFrac * cp.length;
  const an = analyzeCurveAt(d, cv, s);
  const a = d.solids[cv.a];
  const b = d.solids[cv.b];
  const ti = an.ti;
  const topoKind = (() => {
    // 拓扑提取（classifyCurve）给出的该处类型，用于一致性对照
    let k = 0;
    for (let i = 1; i < cp.s.length; i++) if (cp.s[i] <= s) k = i;
    const pc = cv.pieces.find((p) => Math.min(p.i0, p.i1) <= k && k <= Math.max(p.i0, p.i1));
    return pc ? (pc.kind === 'peritectic' ? `转熔型（${d.solids[pc.resorbed].label} 被回溶）` : '共晶型') : '—';
  })();
  const kindText = ti.kind === 'eutectic' ? `共晶型：L → ${a.label} + ${b.label}` : ti.kind === 'peritectic-a' ? `转熔型：L + ${a.label} → ${b.label}` : ti.kind === 'peritectic-b' ? `转熔型：L + ${b.label} → ${a.label}` : '切线平行于连线（退化）';
  return (
    <>
      <PageTitle title="切线规则" desc="界线上某点的切线与两固相连线的交点 = 该瞬间析出固相混合物的成分；交点在线段内为共晶型，在线段外为转熔型。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="切线与连线求交" prov="model" right={<CurvePicker d={d} ci={ci} setCi={setCi} />}>
            <div className="plot-box tall">
              <TernaryPlot d={d} background="fields">
                {(m) => {
                  // 连线端点 = 该点处与液相共轭的固相成分（化学计量相即固定成分点）
                  const A = m.px(an.ya);
                  const B = m.px(an.yb);
                  const ext = (t: number) => m.px([0, 1, 2].map((i) => an.ya[i] + t * (an.yb[i] - an.ya[i])) as [number, number, number]);
                  const e0 = ext(-2);
                  const e1 = ext(3);
                  const p = m.px(an.frame.x);
                  const X = ti.point ? m.px(ti.point) : null;
                  const t: [number, number] = [an.frame.tCool[0], -an.frame.tCool[1]];
                  return (
                    <>
                      <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} className="lnk dash" opacity={0.45} />
                      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={COLOR.accent} strokeWidth={2.2} />
                      <polyline points={cv.pts.map((x) => m.px(x).join(',')).join(' ')} fill="none" stroke={COLOR.stateX0} strokeWidth={3} opacity={0.55} />
                      {X && <line x1={p[0]} y1={p[1]} x2={X[0]} y2={X[1]} stroke={COLOR.path} strokeWidth={1.3} strokeDasharray="5 3" />}
                      <Arrow p={p} q={[p[0] + t[0] * 55, p[1] + t[1] * 55]} cls="tan" />
                      {X && <circle cx={X[0]} cy={X[1]} r={5} fill={ti.kind === 'eutectic' ? COLOR.component[2] : COLOR.stateX0} stroke={COLOR.ink} />}
                      {X && <text x={X[0] + 7} y={X[1] + 14} className="pt-lab">x*（λ = {fmtNum(ti.lambda, 3)}）</text>}
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <LocalParam label="位置 s/L" labelWidth={70} value={sFrac} min={0.02} max={0.98} step={0.002} digits={3} onChange={setSFrac} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <MatrixView name="[t | −(b−a)]" M={ti.M} digits={4} />
              <MatrixView name="a − p" M={ti.rhs.map((v) => [v])} digits={4} />
            </div>
            <KV
              rows={[
                ['det', <span className="mono">{fmtNum(ti.det, 5)}</span>],
                ['(τ, λ)', <span className="mono">({fmtNum(ti.tau, 4)}, {fmtNum(ti.lambda, 4)})</span>],
                ['τ < 0（交点在切线反向延长线上）', <span className={ti.backward ? 'ok' : 'bad'}>{ti.backward ? '是' : '否 —— 该段液相总量在增加或数值异常'}</span>],
                [`dn_${a.label} : dn_${b.label} = (1−λ) : λ`, <span className="mono">{ti.ratio ? `${fmtNum(ti.ratio[0], 3)} : ${fmtNum(ti.ratio[1], 3)}` : '—'}</span>],
                ['切线规则判定', <b>{kindText}</b>],
                ['拓扑提取模块的独立判定', <span>{topoKind}</span>],
              ]}
            />
          </Panel>
          <Panel title="λ 沿界线的变化" prov="model" sub="λ ∈ (0,1)：共晶型；越出：转熔型">
            <XYPlot
              height={170}
              series={[{ id: 'l', pts: scan, color: COLOR.path, label: 'λ(s)' }]}
              ylim={[-1.5, 2.5]}
              hlines={[{ y: 0, color: COLOR.accent, label: 'λ = 0' }, { y: 1, color: COLOR.accent, label: 'λ = 1' }]}
              vlines={[{ x: s, color: COLOR.path }]}
              xlabel="界线弧长 s"
              ylabel="λ"
              onPick={(x) => setSFrac(Math.max(0.02, Math.min(0.98, x / cp.length)))}
            />
          </Panel>
        </div>
        <Layers5
          def={
            <>
              <p>在界线上任一点作切线，与两初晶相成分点的连线（或其延长线）相交：交点在连线段内 ⇒ 该段为共晶型（两相同时析出）；交点在延长线上 ⇒ 转熔型（远离交点的那个固相被回溶）。</p>
              <p className="note"><Prov k="assume" /> 平衡结晶；两固相成分固定；液相量随降温减少（总析出量为正）。</p>
            </>
          }
          geo={<p>液相成分沿切线方向移动，"失去"的物质（瞬时析出混合物 x*）必在切线的反方向上；x* 又只能是两固相的组合，因而落在直线 ab 上 —— 两条直线的交点。</p>}
          math={
            <>
              <p>微分质量守恒（L 为液相量）：</p>
              <TeXBlock>{String.raw`d(L x_L) = -dn_a x_a - dn_b x_b,\quad dL = -(dn_a + dn_b)`}</TeXBlock>
              <TeXBlock>{String.raw`L\,dx_L = -(dn_a + dn_b)(x^{*} - x_L),\quad x^{*} = \frac{dn_a x_a + dn_b x_b}{dn_a + dn_b}`}</TeXBlock>
              <p>
                故 x* 在过 x_L、方向为 dx_L 的直线上（τ &lt; 0 一侧），且在直线 ab 上。求交即解 2×2 线性方程组
                <TeX>{String.raw`[\,t \mid -(b-a)\,]\,(\tau,\lambda)^{\mathsf T} = a - p`}</TeX>，x* = (1−λ)a + λb ⇒ dn_a : dn_b = (1−λ) : λ。
                λ ∉ [0,1] ⇒ 一个 dn 为负 ⇒ 该固相被回溶。
              </p>
            </>
          }
          phys={<p>界线的类型不是由"界线的样子"决定的，而是由"液相在失去什么"决定的：瞬时析出物的成分若需要负量的某个固相才能拼出，那个固相就在被消耗（转熔）。</p>}
          verify={
            <>
              <p>• 选择含不一致熔融化合物 D 的体系，A/D 界线：λ 全程越出 [0,1]，判为 L + A → D，与拓扑模块（独立地按差分计算）一致。</p>
              <p>• 在 λ 曲线穿过 0 或 1 处，界线由共晶型变为转熔型（二维图上箭头由单变双）。</p>
              <div className="callout warn">
                <b>反例与局限：</b>①切线与连线平行时 det = 0，交点在无穷远（退化），规则无法给出结论。②固溶体：a、b 成分随温度变化，x* 不在固定连线上，必须用实际共存成分。
                ③非平衡凝固中先析出相被包裹而无法回溶，"转熔"可能不发生（见"凝固路径 · Scheil 对比"）。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}
