import { useSyncExternalStore } from 'react';

/**
 * 轻量哈希路由（无第三方依赖，静态部署可用）。
 *   #/<page>[/<sub>]?<query>
 * query 承载共享物理状态（体系、成分、温度、参数），因此任意页面链接都可以完整复现状态。
 */
export type PageId = 'workspace' | 'linear' | 'rules' | 'thermo' | 'path' | 'lab';

export interface Route {
  page: PageId;
  sub: string;
  query: URLSearchParams;
}

export const PAGE_IDS: PageId[] = ['workspace', 'linear', 'rules', 'thermo', 'path', 'lab'];

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [p, sub] = (path || '').split('/');
  const page = (PAGE_IDS as string[]).includes(p) ? (p as PageId) : 'workspace';
  return { page, sub: sub ?? '', query: new URLSearchParams(qs ?? '') };
}

export function buildHash(page: PageId, sub: string, query: URLSearchParams): string {
  const qs = query.toString();
  return `#/${page}${sub ? `/${sub}` : ''}${qs ? `?${qs}` : ''}`;
}

const listeners = new Set<() => void>();
let current = parseHash(typeof location !== 'undefined' ? location.hash : '');
let currentKey = typeof location !== 'undefined' ? location.hash : '';

function onHash() {
  if (location.hash === currentKey) return;
  currentKey = location.hash;
  current = parseHash(location.hash);
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined') window.addEventListener('hashchange', onHash);

export function getRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** 导航到页面（保留当前 query，即保留物理状态） */
export function navigate(page: PageId, sub = '') {
  location.hash = buildHash(page, sub, current.query);
}

/** 仅替换 query（不新增历史记录），用于把状态写回地址栏 */
export function replaceQuery(q: URLSearchParams) {
  const h = buildHash(current.page, current.sub, q);
  if (h === location.hash) return;
  current = { ...current, query: q };
  currentKey = h;
  history.replaceState(null, '', h);
}
