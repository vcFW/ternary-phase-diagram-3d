import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cel, solidColor, toC, toK } from '../../core/colors';
import type { Comp } from '../../core/types';
import { analyzePoint } from '../../math/pointAnalysis';
import { CoolingDock } from '../../panels/CoolingDock';
import { ExamplesCard, LayersCard, SectionCard, SystemCard } from '../../panels/Sidebar';
import { VerticalView } from '../../panels/VerticalView';
import { Viewport3D } from '../../scene/Viewport3D';
import { useStore, type Overlays, type View2D } from '../../state/store';
import { NumField, SliderRow } from '../../ui/controls';
import { PhaseFigure2D } from './PhaseFigure2D';
import { Inspector } from './Inspector';
import { navigate } from '../../app/router';

/**
 * 页面 1 · 相图工作台（MATLAB 式科学计算界面）。
 *   工具条：交互模式 | 二维视图 | 叠加层 | 截面 / 三维图层 / 典型成分 / 体系 下拉面板
 *   图 1：交互式二维相图（拖动 x₀、单击界线 / 不变点）       图 2：三维相图（同步的状态点、截面）
 *   模式条：成分探索（x₀ 可变，T 为参数）/ 冷却凝固（x₀ 固定，T 为驱动变量）
 *   检查器：相平衡 · 反应 · 几何与向量 · 稳定性 · 数学推导 · 演化 · 选中对象
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
  const ov = useStore((s) => s.overlays);
  const setOv = useStore((s) => s.setOverlays);
  const setMode = useStore((s) => s.setMode);
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
        <TGroup label="模式">
          <div className="tbtns">
            <TBtn on={mode === 'composition'} onClick={() => setMode('composition')} title="改变总成分 x₀（温度为参数）">
              <b>成分探索</b>
              <small>x₀ 可变</small>
            </TBtn>
            <TBtn on={mode === 'cooling'} onClick={() => setMode('cooling')} title="总成分固定，温度下降">
              <b>冷却凝固</b>
              <small>x₀ 固定</small>
            </TBtn>
          </div>
        </TGroup>
        <TGroup label="二维视图">
          <div className="tbtns">
            {(['iso', 'proj', 'vert'] as View2D[]).map((v) => (
              <TBtn key={v} on={view === v} onClick={() => setView(v)}>
                <b>{v === 'iso' ? '等温截面' : v === 'proj' ? '液相面投影' : '垂直截面'}</b>
              </TBtn>
            ))}
          </div>
        </TGroup>
        <TGroup label="叠加层">
          <div className="tchecks">
            {OVERLAY_LABELS.map((o) => (
              <label key={o.k} title={o.title}>
                <input type="checkbox" checked={ov[o.k]} onChange={(e) => setOv({ [o.k]: e.target.checked })} />
                {o.label}
              </label>
            ))}
          </div>
        </TGroup>
        <TGroup label="设置">
          <div className="tbtns">
            <Drop label="体系">
              <SystemCard />
            </Drop>
            <Drop label="典型成分">
              <ExamplesCard />
            </Drop>
            <Drop label="截面">
              <SectionCard />
            </Drop>
            <Drop label="三维图层">
              <LayersCard />
            </Drop>
          </div>
        </TGroup>
        <TGroup label="转到分析">
          <div className="tbtns">
            <TBtn onClick={() => navigate('linear', 'lever')}>
              <b>线性方程组</b>
            </TBtn>
            <TBtn onClick={() => navigate('thermo', 'ternary')}>
              <b>公切面</b>
            </TBtn>
            <TBtn onClick={() => navigate('path')}>
              <b>凝固路径</b>
            </TBtn>
          </div>
        </TGroup>
        <span className="grow" />
        <TGroup label="布局">
          <div className="tbtns">
            <TBtn on={focus} onClick={() => setFocus(!focus)} title="只显示两幅图">
              <b>{focus ? '还原' : '专注图形'}</b>
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
          </header>
          <div className="mfig-body">{view === 'vert' ? <VerticalView /> : <PhaseFigure2D an={an} trail={hist.map((h) => h.x)} />}</div>
          <ModeBar />
        </section>

        <section className="mfig fig3d">
          <header className="mfig-title">
            <span className="mfig-no">图 2</span>
            <span>三维相图（x_A, x_B, T）　状态点 = (x₀, T)</span>
          </header>
          <div className="mfig-body stage">
            <Viewport3D />
          </div>
          {mode === 'cooling' && (
            <div className="fig3d-dock">
              <CoolingDock />
            </div>
          )}
        </section>

        <aside className="mfig insp-wrap">
          <header className="mfig-title">
            <span className="mfig-no">检查器</span>
            <span>“移动一个点，同时理解几何、数学与物理”</span>
          </header>
          <Inspector an={an} history={hist} />
        </aside>
      </div>
    </div>
  );
}

function ModeBar() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const mode = useStore((s) => s.mode);
  const setComp = useStore((s) => s.setComp);
  const setT = useStore((s) => s.setT);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const setIdx = useStore((s) => s.setIdx);
  const xi = useStore((s) => s.xi);
  const range = d.tRange();
  const sym = d.params.components.map((c) => c.symbol);
  if (mode === 'composition')
    return (
      <div className="modebar comp">
        <span className="mb-tag">成分探索</span>
        <span className="mb-field">
          x₀
          {([0, 1, 2] as const).map((i) => (
            <span key={i} className="mb-num" style={{ color: solidColor(i) }}>
              {sym[i]}
              <NumField value={x0[i] * 100} min={0} max={100} step={0.5} digits={1} width={46} onCommit={(v) => setComp(i, v / 100)} />
            </span>
          ))}
          %
        </span>
        <div className="mb-slider">
          <SliderRow label="截面温度（参数）" labelWidth={104} value={toC(T)} min={Math.floor(toC(range.Tmin))} max={Math.ceil(toC(range.Tmax))} step={1} unit="°C" onChange={(v) => setT(toK(v))} />
        </div>
        <span className="mb-hint">拖动图中 x₀ · 单击界线 / 不变点查看推导</span>
      </div>
    );
  const S = trace.samples;
  return (
    <div className="modebar cool">
      <span className="mb-tag">冷却凝固</span>
      <span className="mb-field mono" title="封闭体系：总成分不随冷却改变">
        x₀ 🔒 {sym.map((s, i) => `${s} ${(x0[i] * 100).toFixed(1)}`).join(' · ')}
      </span>
      <button className="btn sm" onClick={() => { if (idx >= S.length - 1) setIdx(0); setPlaying(!playing); }}>
        {playing ? '❚❚ 暂停' : '▶ 冷却'}
      </button>
      <button className="btn sm" onClick={() => { const nx = trace.events.find((e) => e.index > idx + 0.5); if (nx) setIdx(nx.index); }}>
        下一事件 ⏭
      </button>
      <div className="mb-slider">
        <SliderRow label="温度（驱动变量）" labelWidth={104} value={toC(T)} min={Math.floor(toC(S[S.length - 1].T))} max={Math.ceil(toC(S[0].T))} step={0.5} unit="°C" onChange={(v) => setT(toK(v))} />
      </div>
      <span className="mb-hint">{xi >= 0 ? `不变反应平台：T 不变，反应进度 ξ = ${(xi * 100).toFixed(0)}%` : '移动的是液相成分 x_L（蓝），不是 x₀'}</span>
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
