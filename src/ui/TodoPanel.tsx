// TodoPanel — 动态悬浮任务面板
// 轮询 todo-state，渲染当前会话的 todo 列表。
// 全部完成后显示 1.5s 提示，再由本组件负责 clearTodos。

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { getTodos, clearTodos } from '../services/todo-state'
import type { Todo, TodoStatus } from '../services/todo-state'

const POLL_MS = 300
const DONE_LINGER_MS = 1500

const ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '●',
}

const COLOR: Record<TodoStatus, string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
}

export function TodoPanel({ namespace = 'main' }: { namespace?: string }) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [showDone, setShowDone] = useState(false)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 轮询 todo-state
  useEffect(() => {
    const id = setInterval(() => {
      setTodos(getTodos(namespace))
    }, POLL_MS)
    return () => clearInterval(id)
  }, [namespace])

  // 检测全部完成 → 启动 1.5s 倒计时 → clearTodos
  useEffect(() => {
    const allDone = todos.length > 0 && todos.every(t => t.status === 'completed')

    if (allDone && !showDone) {
      setShowDone(true)
      lingerTimer.current = setTimeout(() => {
        clearTodos(namespace)
        setShowDone(false)
      }, DONE_LINGER_MS)
    }

    if (!allDone && lingerTimer.current) {
      clearTimeout(lingerTimer.current)
      lingerTimer.current = null
      setShowDone(false)
    }

    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    }
  }, [todos, namespace, showDone])

  if (todos.length === 0) return null

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>  Tasks</Text>
      {todos.map(todo => (
        <Box key={todo.id}>
          <Text color={COLOR[todo.status]}>
            {'  '}{ICON[todo.status]}{'  '}{todo.content}
          </Text>
          {todo.priority === 'high' && (
            <Text color="red"> !</Text>
          )}
        </Box>
      ))}
      {showDone && (
        <Text color="green">{'  '}✓  所有任务已完成</Text>
      )}
    </Box>
  )
}
