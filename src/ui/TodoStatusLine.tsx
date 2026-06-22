// TodoStatusLine — 恒高单行 todo 摘要。
// 取代可变高度的浮动 TodoPanel：清单本体随 TodoWrite 工具调用内联滚走,
// 这里只在输入框上方留一行恒高摘要 ○p ◉i ●c · <当前任务>，永不顶飞输入框。
// 无 todo 时返回 null（0 行）。

import React, { useState, useEffect } from 'react'
import { Text } from 'ink'
import { getTodos, clearTodos } from '../services/todo-state'
import type { Todo } from '../services/todo-state'
import { clampLineWidth } from '../utils/termWidth'

const POLL_MS = 300

export function TodoStatusLine({ namespace = 'main', columns = 80 }: { namespace?: string; columns?: number }) {
  const [todos, setTodos] = useState<Todo[]>([])

  useEffect(() => {
    const id = setInterval(() => {
      const next = getTodos(namespace)
      // 全部完成即自清：完成的清单已随 TodoWrite 内联留痕，这一行无需再以 ●N 残留。
      if (next.length > 0 && next.every(t => t.status === 'completed')) {
        clearTodos(namespace)
        setTodos([])
        return
      }
      setTodos(next)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [namespace])

  if (todos.length === 0) return null

  const pending = todos.filter(t => t.status === 'pending').length
  const inprog = todos.filter(t => t.status === 'in_progress').length
  const completed = todos.filter(t => t.status === 'completed').length
  const current = todos.find(t => t.status === 'in_progress')?.content ?? ''

  const counts = `○${pending} ◉${inprog} ●${completed}`
  const line = current ? `${counts} · ${current}` : counts

  return <Text dimColor wrap="truncate-end">{clampLineWidth(line, columns - 1)}</Text>
}
