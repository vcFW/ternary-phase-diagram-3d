import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cel } from '../../core/colors';
import type { Comp } from '../../core/types';
import { analyzePoint } from '../../math/pointAnalysis';
import { CoolingTransport } from '../../panels/CoolingTransport';
import { ExamplesCard, SectionCard } from '../../panels/Sidebar';
import { VerticalView } from '../../panels/VerticalView';
import { Viewport3D } from '../../scene/Viewport3D';
import { OVERLAY_PRESETS, useStore, type Overlays, type View2D } from '../../state/store';
import { PhaseFigure2D } from './PhaseFigure2D';
import { Inspector } from './Inspector';
import { navigate } from '../../app/router';

/**
 * 页面 1 · 相图工作台（MATLAB 式科学计算界面）。
 *   全局状态（体系 / 模式 / x₀ / T / 热力学参数）只在顶栏修改；本页不再放重复控件。
 *   工具条：视图 | 叠加层 | 截面与示例 | 转到分析
 *   图 1：交互式二维相图（拖动 x₀、单击界线 / 不变点）       图 2：三维相图（自带视角 / 图层工具条）
 *   冷却模式：底部为全站唯一的冷却时间轴（CoolingTransport）
 *   检查器：相平衡 · 推导 · 选中对象 · 说明
 */

const OVERLAY_LABELS: { k: keyof Overlays; label: string; title: string }[] = [
  { k: 'eq', label: '连结线/三角形', title: '平衡相点、连结线或连结三角形、杠杆臂' },
  { k: 'read', label: '读数线', title: '过 x₀ 平行于各边的等含量线（辅助投影线）' },
  { k: 'vec', label: '成分向量', title: 'x₀ = A + x_B(B−A) + x_C(C−A)' },
  { k: 'grad', label: '∇T', title: '液相面梯度与等温线切向' },
  { k: 'frame', label: '界线标架', title: '液相所在界线的切向 t、法向 n 与液相移动方向' },
  { k: 'path', label: '液相轨迹', title: 'x₀ 固定冷却时液相成分的轨迹' },
  { k: 'trail', label: 'x₀ 轨迹', title: '成分探索中 x₀ 的移动轨迹与位移向量 Δx₀' },
  { k: 'nbr', label: '相邻相区', title: '恒温下沿 12 个方向移动 x₀ 将进入的相区' },
];

export default function WorkspacePage() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  const trace = useStore((s) => s.trace);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view2d);
  const setView = useStore((s) => s.setView2d);
  const focus = useStore((s) => s.focus3d);
  const setFocus = useStore((s) => s.setFocus);
  const setSel = useStore((s) => s.setSel);

  // 分析在"延迟值"上计算：拖动时界面保持流畅，分析结果紧随其后
  const dx = useDeferredValue(x0);
  const dT = useDeferredValue(T);
  const deq = useDeferredValue(eq);
  const an = useMemo(() => {
    try {
      return analyzePoint(d, dx, dT, deq, trace);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [d, dx, dT, deq, trace]);

  // 成分探索：记录 x₀ 轨迹、G 与相分数（用于"演化"）
  const [hist, setHist] = useState<{ x: Comp; G: number; f: Record<string, number> }[]>([]);
  const lastUid = useRef(d.uid);
  useEffect(() => {
    if (lastUid.current !== d.uid) {
      lastUid.current = d.uid;
      setHist([]);
      return;
    }
    if (mode !== 'composition') return;
    setHist((h) => {
      const prev = h[h.length - 1];
      if (prev && Math.hypot(prev.x[0] - x0[0], prev.x[1] - x0[1], prev.x[2] - x0[2]) < 0.004) return h;
      const f: Record<string, number> = {};
      for (const p of eq.phases) f[p.id] = p.frac;
      return [...h.slice(-79), { x: x0, G: eq.G, f }];
    });
  }, [x0, eq, mode, d.uid]);

  const viewTitle = view === 'iso' ? `等温截面　T = ${cel(T, 1)}` : view === 'proj' ? '液相面投影（等温线间隔 50 K）' : '垂直截面';
  return (
    <div className={`wsx ${focus ? 'focus' : ''} mode-${mode}`}>
      <div className="tstrip">
        <TGroup label="视图">
          <div className="tbtns">
            {(['iso', 'proj', 'vert'] as View2D[]).map((v) => (
              <TBtn key={v} on={view === v} onClick={() => setView(v)}>
                <b>{v === 'iso' ? '等温截面' : v === 'proj' ? '液相面投影' : '垂直截面'}</b>
              </TBtn>
            ))}
          </div>
        </TGroup>
        <TGroup label="叠加层">
          <div className="tbtns">
            <Drop label="叠加层">
              <OverlayMenu />
            </Drop>
          </div>
        </TGroup>
        <TGroup label="截面与示例">
          <div className="tbtns">
            <Drop label="截面设置">
              <SectionCard />
            </Drop>
            <Drop label="典型成分">
              <ExamplesCard />
            </Drop>
          </div>
        </TGroup>
        <TGroup label="转到分析">
          <div className="tbtns">
            <TBtn onClick={() => navigate('linear', 'lever')} title="线性方程组：杠杆 / 重心规则">
              <b>线性方程组</b>
            </TBtn>
            <TBtn onClick={() => navigate('thermo', 'ternary')} title="三元公切面与吉布斯能最小化">
              <b>公切面</b>
            </TBtn>
            <TBtn onClick={() => navigate('path')} title="平衡冷却逐步推演">
              <b>凝固路径</b>
            </TBtn>
          </div>
        </TGroup>
      </div>

      <div className="wsx-body">
        <section className="mfig fig2d">
          <header className="mfig-title">
            <span className="mfig-no">图 1</span>
            <span>{viewTitle}</span>
            <span className="grow" />
            <button className="mfig-tb" title="取消选中的界线 / 不变点" onClick={() => setSel(null)}>
              ⊘
            </button>
            <button className="mfig-tb" title={focus ? '还原三栏布局' : '专注图形：只显示两幅图'} onClick={() => setFocus(!focus)}>
              {focus ? '⤡' : '⤢'}
            </button>
          </header>
          <div className="mfig-body">{view === 'vert' ? <VerticalView /> : <PhaseFigure2D an={an} trail={hist.map((h) => h.x)} />}</div>
        </section>

        <section className="mfig fig3d">
          <header className="mfig-title">
            <span className="mfig-no">图 2</span>
            <span>三维相图（x_A, x_B, T）　状态点 = (x₀, T)</span>
          </header>
          <div className="mfig-body stage">
            <Viewport3D />
          </div>
        </section>

        <aside className="mfig insp-wrap">
          <header className="mfig-title">
            <span className="mfig-no">检查器</span>
            <span>“移动一个点，同时理解几何、数学与物理”</span>
          </header>
          <Inspector an={an} history={hist} />
        </aside>
      </div>
      {mode === 'cooling' && <CoolingTransport />}
    </div>
  );
}

/** 叠加层菜单：三个预设（基本 / 几何 / 全部）+ 逐项复选 */
function OverlayMenu() {
  const ov = useStore((s) => s.overlays);
  const setOv = useStore((s) => s.setOverlays);
  const same = (p: Overlays) => (Object.keys(p) as (keyof Overlays)[]).every((k) => p[k] === ov[k]);
  return (
    <div className="ovmenu">
      <div className="ov-presets">
        {(Object.keys(OVERLAY_PRESETS) as (keyof typeof OVERLAY_PRESETS)[]).map((k) => (
          <button key={k} className={`tbtn ${same(OVERLAY_PRESETS[k].set) ? 'on' : ''}`} onClick={() => setOv(OVERLAY_PRESETS[k].set)} title={OVERLAY_PRESETS[k].title}>
            <b>{OVERLAY_PRESETS[k].label}</b>
          </button>
        ))}
      </div>
      <div className="tchecks">
        {OVERLAY_LABELS.map((o) => (
          <label key={o.k} title={o.title}>
            <input type="checkbox" checked={ov[o.k]} onChange={(e) => setOv({ [o.k]: e.target.checked })} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function TGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tgroup">
      <div className="tgroup-body">{children}</div>
      <div className="tgroup-label">{label}</div>
    </div>
  );
}

function TBtn({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button className={`tbtn ${on ? 'on' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Drop({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="tdrop" ref={ref}>
      <button className={`tbtn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        <b>{label} ▾</b>
      </button>
      {open && <div className="tdrop-panel">{children}</div>}
    </div>
  );
}
