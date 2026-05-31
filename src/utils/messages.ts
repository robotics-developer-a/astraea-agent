// 消息规范化工具函数
// 参考源码: claude-code-main/src/utils/messages.ts
//
// 核心职责：把内部 Message[] 转成 API 接受的 (UserMessage | AssistantMessage)[]
// 原版的复杂特性（thinking blocks、attachments、MCP tool references、图片处理）
// 全部省略，只保留核心逻辑

import type { AssistantMessage, TextBlock, ToolResultBlock, ToolUseBlock, UserMessage, Message } from '../types/message'

// ─────────────────────────────── 内部辅助函数 ────────────────────────────────

// 把 string 或 block[] 统一转成 block[]，方便后续处理
function normalizeUserContent(
  content: string | (TextBlock | ToolResultBlock)[],
): (TextBlock | ToolResultBlock)[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content
}

/**
 * tool_result 块必须排在 user message content 的最前面。
 * 原因：API 要求 tool_result 紧跟 tool_use（角色切换语义），
 * 如果把 text 放在 tool_result 前面，API 会报 400 错误。
 */
function hoistToolResults(
  content: (TextBlock | ToolResultBlock)[],
): (TextBlock | ToolResultBlock)[] {
  const toolResults = content.filter(b => b.type === 'tool_result')
  const others = content.filter(b => b.type !== 'tool_result')
  return [...toolResults, ...others]
}

/**
 * 拼接两段内容时，在 text-text 接缝处加 \n。
 * 如果不加，两个相邻的 text block 会被 API 直接拼接，"2+2" + "3+3" → "2+23+3"。
 */
function joinTextAtSeam(
  a: (TextBlock | ToolResultBlock)[],
  b: (TextBlock | ToolResultBlock)[],
): (TextBlock | ToolResultBlock)[] {
  const lastA = a.at(-1)
  const firstB = b[0]
  if (lastA?.type === 'text' && firstB?.type === 'text') {
    return [...a.slice(0, -1), { ...lastA, text: lastA.text + '\n' }, ...b]
  }
  return [...a, ...b]
}

/**
 * 合并两个相邻的 user message。
 * API 不允许连续两个 user 角色消息（Bedrock 硬限制，官方 API 会自动合并但 Bedrock 不会）。
 */
function mergeUserMessages(a: UserMessage, b: UserMessage): UserMessage {
  const aContent = normalizeUserContent(a.content)
  const bContent = normalizeUserContent(b.content)
  return {
    role: 'user',
    content: hoistToolResults(joinTextAtSeam(aContent, bContent)),
  }
}

// 检查 assistant 消息是否只含空白文本（无语义内容）
function isWhitespaceOnly(msg: AssistantMessage): boolean {
  return (
    msg.content.length > 0 &&
    msg.content.every(b => b.type === 'text' && b.text.trim() === '')
  )
}

// ─────────────────────────────── 主函数 ──────────────────────────────────────

/**
 * 把内部 Message[] 转成 API 可接受的 (UserMessage | AssistantMessage)[]。
 *
 * 处理的问题：
 * 1. 合并相邻 user 消息（API 要求 user/assistant 严格交替）
 * 2. tool_result 提前（hoistToolResults）
 * 3. 过滤只含空白的中间 assistant 消息
 * 4. 确保非末尾 assistant 消息内容非空
 *
 * 不处理的问题（原版有，mimic 跳过）：
 * - thinking blocks 的过滤和保留规则
 * - attachment / progress / system 消息的特殊处理
 * - isVirtual 虚拟消息过滤
 * - MCP tool_reference 块的处理
 * - 图片大小校验
 */
export function normalizeMessagesForAPI(
  messages: Message[],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const last = result.at(-1)
      if (last?.role === 'user') {
        // 合并相邻 user 消息
        result[result.length - 1] = mergeUserMessages(last as UserMessage, msg as UserMessage)
      } else {
        result.push(msg as UserMessage)
      }
    } else if (msg.role === 'assistant') {
      result.push(msg as AssistantMessage)
    }
    // 其他类型（progress、system 等）直接忽略
  }

  // ── Pass 2: 过滤只含空白的中间 assistant 消息 ─────────────────────────────
  // 删除 assistant 消息后可能产生新的相邻 user 消息，需要再次合并
  const filtered: (UserMessage | AssistantMessage)[] = []
  let i = 0
  while (i < result.length) {
    const msg = result[i]!
    const isLast = i === result.length - 1

    if (msg.role === 'assistant' && !isLast && isWhitespaceOnly(msg as AssistantMessage)) {
      // 删除这个空白 assistant 消息
      // 检查前后是否都是 user 消息，若是则合并它们
      const prev = filtered.at(-1)
      const next = result[i + 1]
      if (prev?.role === 'user' && next?.role === 'user') {
        filtered[filtered.length - 1] = mergeUserMessages(prev as UserMessage, next as UserMessage)
        i += 2 // 跳过 next，它已被合并
        continue
      }
      i++ // 只跳过这个空白 assistant
      continue
    }

    filtered.push(msg)
    i++
  }

  // ── Pass 3: 确保非末尾 assistant 消息内容非空 ─────────────────────────────
  // API 要求 "all messages must have non-empty content except the optional final assistant message"
  return filtered.map((msg, idx) => {
    if (msg.role !== 'assistant') return msg
    if (idx === filtered.length - 1) return msg // 末尾消息允许为空（prefill 用途）
    const aMsg = msg as AssistantMessage
    if (aMsg.content.length === 0) {
      return { ...aMsg, content: [{ type: 'text' as const, text: '[No content]' }] }
    }
    return msg
  })
}

// ─────────────────────────────── 错误恢复工具 ────────────────────────────────

/**
 * 为所有未收到结果的 tool_use 生成占位 tool_result。
 *
 * 使用场景：query 循环被中断（Ctrl+C）或 API 调用出错，此时 assistant 消息
 * 里已经有 tool_use blocks，但对应的工具还没执行完、没有 tool_result。
 * 如果直接把这个 assistant 消息加入历史，下次 API 调用会因 tool_use/tool_result
 * 不配对而报 400 错误。
 *
 * 参考源码: claude-code-main/src/query.ts yieldMissingToolResultBlocks()
 */
export function* yieldMissingToolResultBlocks(
  assistantMessage: AssistantMessage,
  errorMessage: string,
): Generator<UserMessage> {
  const toolUseBlocks = assistantMessage.content.filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  )
  for (const toolUse of toolUseBlocks) {
    yield {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: errorMessage,
          is_error: true,
        },
      ],
    }
  }
}

/**
 * 从消息历史中找出所有已有 tool_use 但缺少对应 tool_result 的 tool_use ID。
 * 用于在 session resume 时检测不完整的工具调用。
 */
export function findUnpairedToolUseIds(messages: Message[]): Set<string> {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseIds.add(block.id)
        }
      }
    } else if (msg.role === 'user') {
      const content = Array.isArray(msg.content) ? msg.content : []
      for (const block of content) {
        if (block.type === 'tool_result') {
          toolResultIds.add(block.tool_use_id)
        }
      }
    }
  }

  return new Set([...toolUseIds].filter(id => !toolResultIds.has(id)))
}
