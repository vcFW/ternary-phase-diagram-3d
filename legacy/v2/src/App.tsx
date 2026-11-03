import { InfoPanel } from './panels/InfoPanel';
import { IsoView } from './panels/IsoView';
import { ProjectionView } from './panels/ProjectionView';
import { Sidebar } from './panels/Sidebar';
import { StatusCard } from './panels/StatusCard';
import { VerticalView } from './panels/VerticalView';
import { CoolingDock } from './panels/CoolingDock';
import { Viewport3D } from './scene/Viewport3D';
import { getPreset } from './core/presets';
import { useStore, type Tab } from './state/store';
import { Segmented } from './ui/controls';

export function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const focus = useStore((s) => s.focus3d);
  const setFocus = useStore((s) => s.setFocus);
  const dockOpen = useStore((s) => s.dockOpen);
  const presetId = useStore((s) => s.presetId);
  const preset = getPreset(presetId);
  return (
    <div className={`app ${focus ? 'focus' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M16 3 L29 26 L3 26 Z" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 3 L16 14 M9 20 L16 14 L23 20" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </span>
          <div>
            <div className="brand-title">三元相图 · 三维交互平台</div>
            <div className="brand-sub">不稳定化合物 · 转熔反应 · 冶金物理化学教学与科研演示</div>
          </div>
        </div>
        <div className="topbar-mid">
          <span className="badge accent">{preset.name}</span>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => setFocus(!focus)} title="隐藏左右面板，专注三维视图（适合课堂投影）">
            {focus ? '还原布局' : '专注三维'}
          </button>
        </div>
      </header>
      <aside className="left">
        <Sidebar />
      </aside>
      <main className="center">
        <div className="stage">
          <Viewport3D />
        </div>
        {dockOpen && (
          <div className="dock-wrap">
            <CoolingDock />
          </div>
        )}
      </main>
      <aside className="right">
        <StatusCard />
        <div className="card views">
          <div className="card-head">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'iso', label: '等温截面' },
                { value: 'vert', label: '垂直截面' },
                { value: 'proj', label: '液相面投影' },
                { value: 'info', label: '讲解' },
              ]}
            />
          </div>
          <div className="views-body">
            {tab === 'iso' && <IsoView />}
            {tab === 'vert' && <VerticalView />}
            {tab === 'proj' && <ProjectionView />}
            {tab === 'info' && <InfoPanel />}
          </div>
        </div>
      </aside>
    </div>
  );
}
