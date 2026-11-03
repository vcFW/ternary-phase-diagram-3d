import { cel, phaseColor, regionName } from '../core/colors';
import { useStore } from '../state/store';
import { Card } from '../ui/controls';

export function StatusCard() {
  const d = useStore((s) => s.diagram);
  const eq = useStore((s) => s.eq);
  const T = useStore((s) => s.T);
  const x0 = useStore((s) => s.x0);
  const xi = useStore((s) => s.xi);
  const sym = d.params.components.map((c) => c.symbol);
  const pct = (v: number) => (v * 100).toFixed(1);
  const onPlateau = xi >= 0;
  return (
    <Card title="当前平衡状态" sub={cel(T, 1)} className="status">
      <div className="status-top">
        <div className="region">{regionName(eq.key)}</div>
        <div className="badges">
          <span className="badge" title="凝聚体系恒压相律 F = C − P + 1 = 4 − P">自由度 F = {onPlateau ? 0 : eq.dof}</span>
          <span className="badge">P = {onPlateau ? eq.phases.length : eq.phases.length}</span>
        </div>
      </div>
      <div className="dim small mono comp-line">
        总成分 {sym[0]} {pct(x0[0])} · {sym[1]} {pct(x0[1])} · {sym[2]} {pct(x0[2])} %
      </div>
      <div className="phase-list">
        {eq.phases.map((p) => (
          <div className="phase-row" key={p.id}>
            <i className="dot" style={{ background: phaseColor(d, p.id) }} />
            <span className="pname">{p.id === 'L' ? '液相 L' : `固相 ${p.id}`}</span>
            <div className="bar">
              <span style={{ width: `${p.frac * 100}%`, background: phaseColor(d, p.id) }} />
            </div>
            <span className="mono pv">{pct(p.frac)}%</span>
            <span className="mono pc dim">
              {p.si < 0 ? `${pct(p.x[0])}/${pct(p.x[1])}/${pct(p.x[2])}` : d.solids[p.si].formula}
            </span>
          </div>
        ))}
      </div>
      {eq.phases.some((p) => p.si < 0) && eq.phases.length > 1 && <div className="dim small">液相成分（{sym.join('/')}，%）见上表右列；各相分数由杠杆规则（重心坐标）给出。</div>}
      {onPlateau && <div className="notice">处于不变反应恒温平台：温度不变，反应进度 ξ = {(xi * 100).toFixed(0)}%。</div>}
    </Card>
  );
}
