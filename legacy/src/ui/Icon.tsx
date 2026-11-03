/** 简洁线性图标（避免系统 emoji 渲染差异） */
export type IconName = 'first' | 'prevEvent' | 'stepBack' | 'play' | 'pause' | 'stepFwd' | 'nextEvent';

const PATHS: Record<IconName, JSX.Element> = {
  first: (
    <>
      <rect x="3" y="3" width="2" height="10" />
      <path d="M13 3 L6 8 L13 13 Z" />
    </>
  ),
  prevEvent: (
    <>
      <path d="M8 3 L2 8 L8 13 Z" />
      <path d="M14 3 L8 8 L14 13 Z" />
    </>
  ),
  stepBack: (
    <>
      <path d="M11 3 L4 8 L11 13 Z" />
    </>
  ),
  play: <path d="M4 2.5 L13 8 L4 13.5 Z" />,
  pause: (
    <>
      <rect x="4" y="3" width="3" height="10" />
      <rect x="9" y="3" width="3" height="10" />
    </>
  ),
  stepFwd: (
    <>
      <path d="M5 3 L12 8 L5 13 Z" />
    </>
  ),
  nextEvent: (
    <>
      <path d="M2 3 L8 8 L2 13 Z" />
      <path d="M8 3 L14 8 L8 13 Z" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
