// live 流式帧的渲染判定。
//
// 关键：判定**不能**把「是否要打 ✸ Astraea 头」(showHeader) 算进去。turn 起点 showHeader
// 恒为 true（上一条是 user），若用它兜底，则正文/工具都还没来时就先画一个空的 ✸ Astraea
// 头，然后干等思考、内容才姗姗冒出——用户视角是「✸ Astraea 先蹦一个、很久后又蹦一个真的」
// （空头在 live、真头在 Static，超宽还会重影成 ✸ Astraea ✸ Astraea）。所以头只在真有正文/
// 工具时才画；空窗期交给下方 StreamStatus 思考行表示「在干活」。
export function hasLiveBody(args: {
  streamingText: string
  liveToolCount: number
  activeTool: string | null
}): boolean {
  return args.streamingText.length > 0 || args.liveToolCount > 0 || args.activeTool != null
}

// INTENT: Live text is only a preview; the complete assistant reply is still accumulated in
// memory and committed to Static history at turn end. We coalesce token bursts into one redraw
// per interval (instead of redrawing on every token), but the interval must stay small enough
// that streaming *reads as live typing*. 1.2s was far too coarse — it made each line appear one
// fragment at a time with long pauses ("好，" … wait … rest). ~80ms ≈ 12 fps: smooth typing feel,
// still coalesces fast bursts; full-text mouse selection remains available once it commits to Static.
export const COPY_FRIENDLY_PREVIEW_INTERVAL_MS = 80

export function shouldPublishLiveTextPreview(args: {
  now: number
  lastPublishedAt: number | null
  force?: boolean
}): boolean {
  return args.force === true
    || args.lastPublishedAt === null
    || args.now - args.lastPublishedAt >= COPY_FRIENDLY_PREVIEW_INTERVAL_MS
}
