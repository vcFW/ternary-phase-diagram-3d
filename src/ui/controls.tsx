import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Card({ title, sub, right, children, className, collapsible, defaultOpen = true }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`card ${className ?? ''}`}>
      <header className="card-head" onClick={collapsible ? () => setOpen(!open) : undefined} style={collapsible ? { cursor: 'pointer' } : undefined}>
        {collapsible && <span className={`chev ${open ? 'open' : ''}`}>▸</span>}
        <span className="card-title">{title}</span>
        {sub && <span className="card-sub">{sub}</span>}
        <span className="grow" />
        {right}
      </header>
      {(!collapsible || open) && <div className="card-body">{children}</div>}
    </section>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={`seg ${size ?? ''}`} role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (b: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span className="lbl">{label}</span>
    </label>
  );
}

/** 数值输入：失焦/回车提交，避免输入过程中被钳位打断 */
export function NumField({ value, onCommit, min, max, step = 1, digits = 1, unit, width = 64, disabled }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; digits?: number; unit?: string; width?: number; disabled?: boolean }) {
  const [txt, setTxt] = useState(value.toFixed(digits));
  const focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setTxt(value.toFixed(digits));
  }, [value, digits]);
  const commit = () => {
    const v = parseFloat(txt);
    if (Number.isFinite(v)) {
      const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
      onCommit(c);
      setTxt(c.toFixed(digits));
    } else setTxt(value.toFixed(digits));
  };
  return (
    <span className="numfield">
      <input
        type="text"
        inputMode="decimal"
        value={txt}
        disabled={disabled}
        style={{ width }}
        onFocus={() => (focus.current = true)}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          focus.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = (parseFloat(txt) || value) + (e.key === 'ArrowUp' ? step : -step);
            const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
            onCommit(c);
            setTxt(c.toFixed(digits));
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function SliderRow({ label, value, min, max, step, onChange, digits = 1, unit, color, labelWidth, format }: { label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; digits?: number; unit?: string; color?: string; labelWidth?: number; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <span className="slabel" style={{ width: labelWidth, color }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--p' as string]: `${pct}%`, ['--c' as string]: color } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {format ? <span className="fmt">{format(value)}</span> : <NumField value={value} min={min} max={max} step={step} digits={digits} unit={unit} onCommit={onChange} />}
    </div>
  );
}

export function Chip({ color, children, onClick, active, title }: { color?: string; children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  return (
    <button className={`chip ${active ? 'on' : ''}`} onClick={onClick} title={title} style={color ? ({ ['--chip' as string]: color } as React.CSSProperties) : undefined}>
      {color && <i className="dot" />}
      {children}
    </button>
  );
}
