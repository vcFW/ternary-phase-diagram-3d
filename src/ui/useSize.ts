import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Size {
  w: number;
  h: number;
  dpr: number;
}

export function useSize(ref: RefObject<HTMLElement>): Size {
  const [s, setS] = useState<Size>({ w: 300, h: 300, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => {
      const r = el.getBoundingClientRect();
      setS({ w: Math.max(40, Math.floor(r.width)), h: Math.max(40, Math.floor(r.height)), dpr: Math.min(2, window.devicePixelRatio || 1) });
    };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

/** 在 rAF 中合并多次重绘 */
export function useRaf(): (fn: () => void) => void {
  const pending = useRef<number | null>(null);
  const fnRef = useRef<() => void>(() => {});
  return (fn) => {
    fnRef.current = fn;
    if (pending.current !== null) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      fnRef.current();
    });
  };
}
