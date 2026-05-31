// 会话上下文 — 存储主会话的系统提示供子 Agent 继承

let _systemPrompt = ''

export function setSessionSystemPrompt(prompt: string): void {
  _systemPrompt = prompt
}

export function getSessionSystemPrompt(): string {
  return _systemPrompt
}
