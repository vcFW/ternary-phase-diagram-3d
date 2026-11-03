import { ALL_REGIONS } from '../core/diagram';
import { describeObject, formatC, phaseColor, phaseLabel, REGION_COLORS, regionDescription, regionName } from '../core/phases';
import { currentState, useStore } from '../state/store';

export function InfoPanel() {
  const d = useStore((s) => s.diagram);
  const x = useStore((s) => s.comp);
  const T = useStore((s) => s.T);
  const sim = useStore((s) => s.sim);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const sym = d.params.components.map((c) => c.symbol);
  const st = currentState(d, x, T, sim);
  const info = selection ? describeObject(selection, d) : null;

  const inv = st.region === 'INV';
  const name = inv ? `L + ${sym.join(' + ')}（四相平衡）` : regionName(st.region, sym);
  const desc = inv
    ? `不变反应进行中：L(E) → ${sym.join(' + ')}，温度恒定，F = 0。反应进度 ${((st.xi ?? 0) * 100).toFixed(0)}%。`
    : regionDescription(st.region, sym);

  return (
    <div className="info">
      <div className="info-block">
        <div className="info-head">
          <span>状态点 P</span>
          <span className="mono small">F = {st.dof}</span>
        </div>
        <div className="kv">
          {x.map((v, n) => (
            <span key={n} className="kv-pair">
              <span>x({sym[n]})</span>
              <b className="mono">{(v * 100).toFixed(2)}%</b>
            </span>
          ))}
          <span className="kv-pair">
            <span>T</span>
            <b className="mono">{formatC(T, 2)}</b>
          </span>
        </div>
        <div className="region-name">
          <i style={{ background: inv ? '#555' : REGION_COLORS[st.region] }} />
          {name}
        </div>
        <table className="phase-table">
          <thead>
            <tr>
              <th>相</th>
              <th>相对量</th>
              <th>相成分 x({sym.join(', ')})</th>
            </tr>
          </thead>
          <tbody>
            {st.phases
              .filter((p) => p.fraction > 1e-9)
              .map((p, n) => (
                <tr key={n}>
                  <td style={{ color: phaseColor(p.phase) }}>{phaseLabel(p.phase, sym)}</td>
                  <td>
                    <div className="bar">
                      <div style={{ width: `${p.fraction * 100}%`, background: phaseColor(p.phase) }} />
                    </div>
                    <span className="mono small">{(p.fraction * 100).toFixed(1)}%</span>
                  </td>
                  <td className="mono small">{p.comp.map((v) => v.toFixed(3)).join(', ')}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="note">{desc}</p>
      </div>

      <div className="info-block">
        <div className="info-head">
          <span>选中对象</span>
          {selection && (
            <button className="link-btn" onClick={() => select(null)}>
              清除
            </button>
          )}
        </div>
        {info ? (
          <>
            <div className="obj-title">
              {info.title} <span className="obj-kind">{info.kind}</span>
            </div>
            {info.rows.length > 0 && (
              <div className="kv">
                {info.rows.map(([k, v], n) => (
                  <span key={n} className="kv-pair">
                    <span>{k}</span>
                    <b className="mono">{v}</b>
                  </span>
                ))}
              </div>
            )}
            <p className="note">{info.explanation}</p>
          </>
        ) : (
          <p className="note">在三维视图或投影图中单击曲面、单变线或特征点以查看说明；或从下方选择相区，在三维中高亮其空间范围。</p>
        )}
        <div className="chips">
          {ALL_REGIONS.map((k) => (
            <button
              key={k}
              className={`chip${selection === `region:${k}` ? ' on' : ''}`}
              onClick={() => select(selection === `region:${k}` ? null : `region:${k}`)}
            >
              <i style={{ background: REGION_COLORS[k] }} />
              {regionName(k, sym)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
