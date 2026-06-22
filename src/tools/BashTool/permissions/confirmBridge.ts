// 权限确认 bridge — 工具层与 Ink UI 层之间的异步通道
//
// 设计同 AskUserQuestion 的 bridge：工具在执行中调用 requestConfirm() 拿到一个
// pending Promise；UI 层（App.tsx）通过 onConfirmRequest 订阅，渲染方向键选择器；
// 用户用 ↑↓ 选择、Enter 确认后，UI 调用 resolveConfirm() resolve 该 Promise。
//
// 这样确认框就和 /mode 选择器一样是"键盘上下选择"，而不是 readline 文本输入。
// 当没有 UI 订阅者（纯 CLI / 测试）时，requestConfirm 立即 fail-closed 返回拒绝，
// 由调用方（confirmWithUser）回退到 readline 实现。

export interface ConfirmRequest {
  /** 要确认的命令或操作标签 */
  command: string
  /** 可选的人类可读描述 */
  description?: string
  /**
   * 确认来源。决定选择器展示哪一组选项：
   *   'bash'（默认）→ Yes / No / Always allow / Always deny（落盘 per-command 规则）
   *   'file'        → Yes / Yes, all edits this session（切 cruise）/ No
   * 文件写不做 per-file 落盘（对齐 CC：acceptEdits 即 Astraea 的 cruise，仅会话内存）。
   */
  kind?: 'bash' | 'file'
}

export interface ConfirmResult {
  proceed: boolean
  /**
   * 用户选了持久化/会话级放行时非 null：
   *   'always-allow' / 'always-deny' — Bash 落盘 per-command 规则
   *   'session-cruise'               — 文件写「本会话全允许」，调用方切 cruise 模式
   */
  remember: 'always-allow' | 'always-deny' | 'session-cruise' | null
}

type Listener = (req: ConfirmRequest) => void

let _pending: { req: ConfirmRequest; resolve: (r: ConfirmResult) => void } | null = null
const _listeners: Listener[] = []

/** 是否有 UI 订阅者（决定走方向键选择器还是 readline 回退）。 */
export function hasConfirmUI(): boolean {
  return _listeners.length > 0
}

/**
 * 发起一次确认。有 UI 时挂起等待用户用 ↑↓ + Enter 选择；
 * 无 UI 时立即 fail-closed 返回拒绝（调用方应改走 readline 回退）。
 */
export function requestConfirm(req: ConfirmRequest): Promise<ConfirmResult> {
  if (_listeners.length === 0) {
    return Promise.resolve({ proceed: false, remember: null })
  }
  return new Promise<ConfirmResult>((resolve) => {
    _pending = { req, resolve }
    for (const fn of _listeners) fn(req)
  })
}

/** UI 层注册监听。返回取消订阅函数。 */
export function onConfirmRequest(fn: Listener): () => void {
  _listeners.push(fn)
  return () => {
    const i = _listeners.indexOf(fn)
    if (i >= 0) _listeners.splice(i, 1)
  }
}

/** UI 层提交用户选择，resolve 工具的 Promise。 */
export function resolveConfirm(result: ConfirmResult): void {
  if (_pending) {
    _pending.resolve(result)
    _pending = null
  }
}

/** 当前是否有未回答的确认请求。 */
export function hasPendingConfirm(): boolean {
  return _pending !== null
}

/** 获取当前未回答的确认请求（供 UI 读取）。 */
export function getPendingConfirm(): ConfirmRequest | null {
  return _pending?.req ?? null
}
