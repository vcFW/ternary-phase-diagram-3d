import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { navigate, replaceQuery, useRoute, type PageId } from './router';
import { GlobalBar } from './GlobalBar';
import { ErrorBoundary } from './ErrorBoundary';
import { useStore } from '../state/store';
import { decodeState, encodeState } from '../state/urlState';
import { getRoute } from './router';

/** 路由级页面：按需加载，三维场景（three.js）只在工作台页面加载 */
const pages: Record<PageId, React.LazyExoticComponent<() => JSX.Element>> = {
  workspace: lazy(() => import('../pages/workspace/WorkspacePage')),
  linear: lazy(() => import('../pages/linear/LinearPage')),
  rules: lazy(() => import('../pages/rules/RulesPage')),
  thermo: lazy(() => import('../pages/thermo/ThermoPage')),
  path: lazy(() => import('../pages/path/PathPage')),
  lab: lazy(() => import('../pages/lab/LabPage')),
};

export const NAV: { id: PageId; no: string; title: string; sub: string; icon: ReactNode }[] = [
  { id: 'workspace', no: '1', title: '相图工作台', sub: '三维空间探索', icon: <path d="M12 3 21 8v8l-9 5-9-5V8z M12 3v18 M3 8l9 5 9-5" /> },
  { id: 'linear', no: '2', title: '线性代数与空间解析', sub: '向量 · 变换 · 投影', icon: <path d="M6 4H4v16h2 M18 4h2v16h-2 M8 9h3 M13 9h3 M8 15h3 M13 15h3" /> },
  { id: 'rules', no: '3', title: '相图规则与定理', sub: '规则的数学推导', icon: <path d="M12 4 21 20H3z M7.5 12h9 M12 4v16" /> },
  { id: 'thermo', no: '4', title: '吉布斯自由能与热力学', sub: '公切线 · 公切面 · 最小化', icon: <path d="M3 6c4 14 14 14 18 0 M4 15l16-4" /> },
  { id: 'path', no: '5', title: '凝固路径与反应推演', sub: '冷却 · 守恒 · 反应', icon: <path d="M4 5c6 0 6 7 10 7s4 7 6 7 M4 5v0 M17 16l3 3-3 1" /> },
  { id: 'lab', no: '6', title: '数学实验与验证', sub: '算例 · 残差 · 退化', icon: <path d="M9 3h6 M10 3v6l-5 10h14l-5-10V3 M7.5 14h9" /> },
];

/** 共享物理状态 ⇄ 地址栏：启动时从 URL 恢复，之后状态变化写回（深链接） */
function useUrlSync() {
  useEffect(() => {
    const q = getRoute().query;
    const st = decodeState(q);
    if (Object.keys(st).length) useStore.getState().hydrate(st);
    let t = 0;
    const write = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = useStore.getState();
        replaceQuery(encodeState({ presetId: s.presetId, x0: s.x0, T: s.T, override: s.override }, getRoute().query));
      }, 250);
    };
    write();
    const unsub = useStore.subscribe((s, p) => {
      if (s.presetId !== p.presetId || s.x0 !== p.x0 || s.T !== p.T || s.override !== p.override) write();
    });
    const onHash = () => {
      const st2 = decodeState(getRoute().query);
      const s = useStore.getState();
      const changed =
        (st2.presetId && st2.presetId !== s.presetId) ||
        (st2.x0 && st2.x0.some((v, i) => Math.abs(v - s.x0[i]) > 1e-4)) ||
        (st2.T && Math.abs(st2.T - s.T) > 0.01);
      if (changed) s.hydrate(st2);
      // 地址中缺少状态（例如手动输入了不带参数的页面地址）时，把当前状态写回
      if (!getRoute().query.get('x')) write();
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      unsub();
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
}

export function AppShell() {
  const route = useRoute();
  // 导航：用户选择优先；否则 < 1280 px 默认收起
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('nav-collapsed');
      if (v !== null) return v === '1';
    } catch {
      /* 存储不可用 */
    }
    return window.innerWidth < 1280;
  });
  useUrlSync();
  const toggleNav = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('nav-collapsed', next ? '1' : '0'); // 只记录用户的显式选择
    } catch {
      /* 存储不可用时忽略 */
    }
  };
  const computing = useStore((s) => s.computing);
  const Page = pages[route.page];
  const cur = NAV.find((n) => n.id === route.page)!;
  useEffect(() => {
    document.title = `${cur.title} · 三元相图数学分析平台`;
  }, [cur]);
  return (
    <div className={`shell ${collapsed ? 'nav-collapsed' : ''}`}>
      <nav className="nav" aria-label="页面导航">
        <div className="nav-brand">
          <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden>
            <path d="M16 3 L29 26 L3 26 Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16 3 L16 14 M9 20 L16 14 L23 20" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          {!collapsed && (
            <div>
              <div className="nav-title">三元相图</div>
              <div className="nav-sub">数学分析与可解释推理</div>
            </div>
          )}
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <a
                href={`#/${n.id}`}
                className={route.page === n.id ? 'on' : ''}
                title={collapsed ? `${n.no}. ${n.title}` : n.sub}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(n.id);
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                  {n.icon}
                </svg>
                {!collapsed && (
                  <span className="nav-txt">
                    <b>
                      {n.no}. {n.title}
                    </b>
                    <span>{n.sub}</span>
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
        <div className="grow" />
        <button className="nav-collapse" onClick={toggleNav} title={collapsed ? '展开导航' : '收起导航'}>
          {collapsed ? '»' : '« 收起'}
        </button>
      </nav>
      <div className={`main ${computing ? 'computing' : ''}`}>
        <GlobalBar page={cur.title} />
        <div className="page" key={route.page}>
          <ErrorBoundary resetKey={`${route.page}/${route.sub}`}>
            <Suspense fallback={<div className="page-loading">正在加载“{cur.title}”…</div>}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
