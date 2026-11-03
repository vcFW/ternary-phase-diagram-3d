import { useState } from 'react';
import { formatC } from './core/phases';
import { ControlsPanel } from './panels/ControlsPanel';
import { CoolingPanel } from './panels/CoolingPanel';
import { InfoPanel } from './panels/InfoPanel';
import { IsothermalView } from './panels/IsothermalView';
import { ProjectionView } from './panels/ProjectionView';
import { VerticalView } from './panels/VerticalView';
import { Viewport } from './scene/Viewport';
import { useStore } from './state/store';
import { Segmented } from './ui/controls';

export function App() {
  const d = useStore((s) => s.diagram);
  const [tab, setTab] = useState<'iso' | 'proj'>('iso');
  const [isoMode, setIsoMode] = useState<'comp' | 'select'>('comp');
  const [projFill, setProjFill] = useState<'field' | 'temperature'>('field');
  const [max3d, setMax3d] = useState(false);
  const sym = d.params.components.map((c) => c.symbol).join('–');
  return (
    <div className={`app${max3d ? ' max3d' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">三元相图三维交互平台</span>
          <span className="brand-sub">冶金物理化学 · 教学与科研可视化原型</span>
        </div>
        <div className="topbar-meta">
          <span>
            体系 <b>{sym}</b>
          </span>
          <span>
            三元共晶 E <b className="mono">{formatC(d.eutectic.T)}</b>
          </span>
          <span className="badge edu">教学模型 · 非实测数据</span>
        </div>
      </header>

      <aside className="left">
        <ControlsPanel />
      </aside>

      <main className="center">
        <div className="card viewport-card">
          <div className="card-head">
            <span className="card-title">三维相图</span>
            <span className="card-sub">成分三角形 × 温度轴 · 液相面、直纹面、三元共晶平面</span>
            <span className="grow" />
            <button className="btn sm" onClick={() => setMax3d(!max3d)}>
              {max3d ? '还原布局' : '最大化'}
            </button>
          </div>
          <Viewport />
        </div>
        <div className="card cooling-card">
          <div className="card-head">
            <span className="card-title">平衡冷却模拟</span>
            <span className="card-sub">成分固定，沿温度轴降温；液相成分沿结晶路径移动</span>
          </div>
          <CoolingPanel />
        </div>
      </main>

      <aside className="right">
        <div className="card tri-card">
          <div className="card-head">
            <Segmented
              value={tab}
              options={[
                { value: 'iso', label: '等温截面' },
                { value: 'proj', label: '液相面投影' },
              ]}
              onChange={setTab}
            />
            <span className="grow" />
            {tab === 'iso' ? (
              <Segmented
                value={isoMode}
                options={[
                  { value: 'comp', label: '单击设成分' },
                  { value: 'select', label: '单击选相区' },
                ]}
                onChange={setIsoMode}
              />
            ) : (
              <Segmented
                value={projFill}
                options={[
                  { value: 'field', label: '初晶区' },
                  { value: 'temperature', label: '温度色图' },
                ]}
                onChange={setProjFill}
              />
            )}
          </div>
          <div className="card-body">{tab === 'iso' ? <IsothermalView mode={isoMode} /> : <ProjectionView fill={projFill} />}</div>
        </div>
        <div className="card vert-card">
          <div className="card-head">
            <span className="card-title">垂直截面</span>
            <span className="card-sub">与三维垂直切片同源，可单击设定状态点</span>
          </div>
          <div className="card-body">
            <VerticalView />
          </div>
        </div>
        <div className="card info-card">
          <InfoPanel />
        </div>
      </aside>
    </div>
  );
}
