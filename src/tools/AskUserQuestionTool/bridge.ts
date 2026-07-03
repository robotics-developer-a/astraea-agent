// AskUserQuestion bridge — 工具层与 UI 层之间的异步通信通道
//
// 工作原理：
//   1. 工具调用 ask(questions)，返回一个 pending Promise
//   2. UI 层（App.tsx）通过 onQuestion() 订阅，收到通知后显示多问题面板
//   3. 用户回答（每题可单选/多选/自填）后，UI 把格式化后的答案文本传给 answer()
//
// 在 CLI 非交互模式下，没有 UI 订阅者，ask() 会立即 resolve 空字符串。
//
// 规范结构（canonical）：一次 ask 可携带 1–4 道相关问题，用户用 ←→ 切题、↑↓ 移动、
// Space 勾选（多选）、Enter 确认/提交。每题第一项约定为模型最推荐项（label 自带「(推荐)」）。

export interface QuestionOption {
  /** 选项标题；counsel 模式下推荐项排第一并在 label 末尾带「(推荐)」 */
  label: string
  /** 选项补充说明（可选），渲染为次要灰字 */
  description?: string
}

export interface Question {
  /** 问题正文 */
  question: string
  /** 极短的分类标签，用作问题标签页（如「实现范围」）。缺省时 UI 用 Q1/Q2… */
  header?: string
  /** 是否允许多选。true 时 Space 勾选多个；false 为单选（radio） */
  multiSelect?: boolean
  /** 选项列表（≥2） */
  options: QuestionOption[]
  /**
   * 可选的 Markdown 正文（如 ExitOrbitMode 的完整计划）。携带时 UI 会把它作为一条
   * 持久化的 markdown 历史条目落盘，问题面板本身只保留精简提示——这样计划即便面板被
   * ESC 关掉也不会从屏幕消失，且以 markdown 渲染而非纯文本。
   */
  planBody?: string
}

export interface PendingQuestion {
  questions: Question[]
}

type Listener = (q: PendingQuestion) => void

// INTENT: 请求排 FIFO 队列而非单槽位。主 agent 与后台 sub-agent 共享本 bridge，
// 并发提问时单槽位会让后到的覆盖先到的，先到的 Promise 永远悬挂 → 工具卡死。
// 队列保证 UI 一次展示队头，answer 后自动推送下一个。
const _queue: { q: PendingQuestion; resolve: (a: string) => void }[] = []
const _listeners: Listener[] = []

/**
 * 提问。在 REPL 模式下挂起等待用户回答；
 * 非交互模式（无监听者）下立即返回空字符串。
 * 并发提问排队：UI 正在展示别的问题时本请求等待，轮到时自动推送给 UI。
 */
export function ask(questions: Question[]): Promise<string> {
  if (_listeners.length === 0) {
    // CLI 一次性模式：无法交互，让模型自行判断
    return Promise.resolve('')
  }
  return new Promise<string>(resolve => {
    const q: PendingQuestion = { questions }
    _queue.push({ q, resolve })
    if (_queue.length === 1) {
      for (const fn of _listeners) fn(q)
    }
  })
}

/**
 * 单题便捷封装：把 (question, string[] options) 包成一道 Question 再走 ask()。
 * 供 ExitOrbitMode / Vigil / counsel「现在开始执行」等只需一个是非/单选确认的调用方使用。
 */
export function askOne(question: string, options?: string[]): Promise<string> {
  const opts = (options ?? []).map(label => ({ label }))
  return ask([{ question, options: opts }])
}

/**
 * UI 层注册监听。返回取消订阅函数。
 */
export function onQuestion(fn: Listener): () => void {
  _listeners.push(fn)
  return () => {
    const i = _listeners.indexOf(fn)
    if (i >= 0) _listeners.splice(i, 1)
    // 最后一个 UI 订阅者退订后再没人能回答了：排空队列（空答案 = 让模型自行判断），
    // 别让等待中的工具永远悬挂。
    if (_listeners.length === 0) {
      const orphaned = _queue.splice(0, _queue.length)
      for (const entry of orphaned) entry.resolve('')
    }
  }
}

/**
 * UI 层提交用户答案，resolve 队头问题的 Promise；有后续问题时立即推送给 UI。
 */
export function answer(text: string): void {
  const head = _queue.shift()
  if (!head) return
  head.resolve(text)
  const next = _queue[0]
  if (next) {
    for (const fn of _listeners) fn(next.q)
  }
}

/**
 * 排空整个队列：所有等待中的问题一律按空答案 resolve（让模型自行判断）。
 * 供 /stop、/clear 等「中止活动工作」的入口调用——中止后没人会再回答这些问题，
 * 不 resolve 它们的话，发起提问的工具调用会永远悬挂。
 */
export function cancelAllQuestions(): void {
  const orphaned = _queue.splice(0, _queue.length)
  for (const entry of orphaned) entry.resolve('')
}

/** 当前是否有未回答的问题 */
export function hasPending(): boolean {
  return _queue.length > 0
}

/** 获取当前未回答的问题（供 UI 读取，始终是队头） */
export function getPending(): PendingQuestion | null {
  return _queue[0]?.q ?? null
}
