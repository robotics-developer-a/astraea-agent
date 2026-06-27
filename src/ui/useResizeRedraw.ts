// useResizeRedraw —— 终端尺寸变化时触发一次整屏重铺。
//
// 为什么需要：Ink 的 <Static> 是 append-only，已落地的滚动区历史行永不重绘。终端 resize 后
// 旧行按新列宽自动折行，Ink 擦不掉 committed 的旧帧，于是历史重影/错位、手绘输入框边框也错位。
// 解法是 resize 后清屏 + 重挂载 <Static>，按新尺寸从头重渲全部 history（见 App 的 wipeStatic）。
//
// 为什么去抖：拖拽窗口边缘会连发几十次 resize。useWindowSize() 内部已监听 resize 事件，这里只对
// 它产出的 columns/rows 变化做反应——用一个 delay(默认 150ms) 的定时器把「一整次拖拽」收敛成
// 末尾的一次 onResize。期间每次尺寸再变都清掉上一个定时器重计时，故只在拖拽停下后触发一次。
//
// 抽成独立 hook 而非内联进 App：这段「跳过挂载帧 + 去抖 + 同值不触发 + 卸载清理」的逻辑有若干
// 边界（首帧不该触发、快速连变只算一次、同值重渲不触发），单独可单元测试（见 useResizeRedraw.test.tsx）。

import { useEffect, useRef } from 'react'

export function useResizeRedraw(
  columns: number | undefined,
  rows: number | undefined,
  onResize: () => void,
  delay = 150,
): void {
  // 记下「上一次真正触发重铺时」的尺寸。初值即挂载时的尺寸 → 挂载帧 deps 与之相等，不触发。
  const prevDims = useRef({ columns, rows })
  useEffect(() => {
    if (prevDims.current.columns === columns && prevDims.current.rows === rows) return
    const id = setTimeout(() => {
      prevDims.current = { columns, rows }
      onResize()
    }, delay)
    return () => clearTimeout(id)
  }, [columns, rows, onResize, delay])
}
