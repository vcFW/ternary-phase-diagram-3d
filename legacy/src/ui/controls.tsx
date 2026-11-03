import { useEffect, useState, type ReactNode } from 'react';

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <header className="section-head" onClick={() => setOpen(!open)}>
        <span className={`caret${open ? ' open' : ''}`} />
        <span className="section-title">{title}</span>
        <span className="section-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/** 数值输入：回车或失焦时提交，非法输入回退 */
export function NumberField({
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  digits = 1,
  unit,
  width = 64,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  unit?: string;
  width?: number;
}) {
  const [text, setText] = useState(value.toFixed(digits));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(value.toFixed(digits));
  }, [value, digits, focus]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) {
      const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
      onCommit(c);
      setText(c.toFixed(digits));
    } else setText(value.toFixed(digits));
  };
  return (
    <span className="numfield" style={{ width }}>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  accent,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accent?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      className="slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--pct' as string]: `${pct}%`, ['--accent' as string]: accent ?? '#0072BD' }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" />
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
