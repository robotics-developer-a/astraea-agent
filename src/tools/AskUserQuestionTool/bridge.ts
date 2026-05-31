// AskUserQuestion bridge — 工具层与 UI 层之间的异步通信通道
//
// 工作原理：
//   1. 工具调用 ask()，返回一个 pending Promise
//   2. UI 层（App.tsx）通过 onQuestion() 订阅，收到通知后显示问题
//   3. 用户输入答案后，UI 调用 answer()，Promise resolve
//
// 在 CLI 非交互模式下，没有 UI 订阅者，ask() 会立即 resolve 空字符串。

export interface PendingQuestion {
  question: string
  options?: string[]
}

type Listener = (q: PendingQuestion) => void

let _pending: { q: PendingQuestion; resolve: (a: string) => void } | null = null
const _listeners: Listener[] = []

/**
 * 提问。在 REPL 模式下挂起等待用户回答；
 * 非交互模式（无监听者）下立即返回空字符串。
 */
export function ask(question: string, options?: string[]): Promise<string> {
  if (_listeners.length === 0) {
    // CLI 一次性模式：无法交互，让模型自行判断
    return Promise.resolve('')
  }
  return new Promise<string>(resolve => {
    _pending = { q: { question, options }, resolve }
    for (const fn of _listeners) fn({ question, options })
  })
}

/**
 * UI 层注册监听。返回取消订阅函数。
 */
export function onQuestion(fn: Listener): () => void {
  _listeners.push(fn)
  return () => {
    const i = _listeners.indexOf(fn)
    if (i >= 0) _listeners.splice(i, 1)
  }
}

/**
 * UI 层提交用户答案，resolve 工具的 Promise。
 */
export function answer(text: string): void {
  if (_pending) {
    _pending.resolve(text)
    _pending = null
  }
}

/** 当前是否有未回答的问题 */
export function hasPending(): boolean {
  return _pending !== null
}

/** 获取当前未回答的问题（供 UI 读取） */
export function getPending(): PendingQuestion | null {
  return _pending?.q ?? null
}
