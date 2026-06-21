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
}

export interface PendingQuestion {
  questions: Question[]
}

type Listener = (q: PendingQuestion) => void

let _pending: { q: PendingQuestion; resolve: (a: string) => void } | null = null
const _listeners: Listener[] = []

/**
 * 提问。在 REPL 模式下挂起等待用户回答；
 * 非交互模式（无监听者）下立即返回空字符串。
 */
export function ask(questions: Question[]): Promise<string> {
  if (_listeners.length === 0) {
    // CLI 一次性模式：无法交互，让模型自行判断
    return Promise.resolve('')
  }
  return new Promise<string>(resolve => {
    const q: PendingQuestion = { questions }
    _pending = { q, resolve }
    for (const fn of _listeners) fn(q)
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
