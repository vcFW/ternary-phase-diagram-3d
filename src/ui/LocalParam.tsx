import type { ComponentProps } from 'react';
import { SliderRow } from './controls';

type SliderProps = ComponentProps<typeof SliderRow>;

/**
 * 页面局部参数：不改变顶栏的全局状态。带"局部"徽标；
 * 若给出 global / onSetGlobal，则显示与全局值的差，并提供"↦ 设为全局"反向同步。
 * （全局状态——体系、x₀、T、模式、热力学参数——只在顶栏修改。）
 */
export function LocalParam({
  global,
  onSetGlobal,
  ...slider
}: SliderProps & {
  /** 对应全局量的当前值（与 value 同单位） */
  global?: number;
  onSetGlobal?: (v: number) => void;
}) {
  const digits = slider.digits ?? 1;
  const diff = global === undefined ? 0 : slider.value - global;
  const differs = Math.abs(diff) > 0.5 * Math.pow(10, -digits);
  return (
    <div className="local-param">
      <span className="badge local" title="局部参数：只影响本页面的演示，不改变顶栏的全局状态">局部</span>
      <div className="lp-slider">
        <SliderRow {...slider} />
      </div>
      {global !== undefined && (
        <span className="lp-diff small mono" title="与全局值的差">
          {differs ? `Δ${diff > 0 ? '+' : ''}${diff.toFixed(digits)}${slider.unit ? ' ' + slider.unit : ''}` : '= 全局'}
        </span>
      )}
      {onSetGlobal && (
        <button className="btn sm ghost" disabled={!differs} onClick={() => onSetGlobal(slider.value)} title="把此局部值写入顶栏的全局状态">
          ↦ 设为全局
        </button>
      )}
    </div>
  );
}
