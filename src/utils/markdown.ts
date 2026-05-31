// Markdown → ANSI terminal renderer
// 使用 marked 解析，chalk 渲染 ANSI 样式
// 策略对齐 claude-code-main/src/utils/markdown.ts + components/Markdown.tsx
import { marked, type Token, type Tokens } from 'marked'
import { Chalk } from 'chalk'
import chalk from 'chalk'

const EOL = '\n'

type C = InstanceType<typeof Chalk>

export function renderMarkdown(text: string): string {
  if (!text.trim()) return text
  // 强制 chalk 输出 ANSI（Ink 接管终端时 isTTY 可能未被探测到）
  const c: C = new Chalk({ level: chalk.level > 0 ? chalk.level : 3 })
  const tokens = marked.lexer(text)
  return tokens.map(t => formatToken(t, c, 0)).join('')
}

function formatToken(token: Token, c: C, listDepth: number): string {
  switch (token.type) {
    case 'heading': {
      const inner = (token.tokens ?? []).map(t => formatToken(t, c, 0)).join('')
      if (token.depth === 1) return c.bold.underline(inner) + EOL + EOL
      return c.bold(inner) + EOL + EOL
    }

    case 'paragraph': {
      const inner = (token.tokens ?? []).map(t => formatToken(t, c, 0)).join('')
      return inner + EOL + EOL
    }

    case 'strong':
      return c.bold((token.tokens ?? []).map(t => formatToken(t, c, 0)).join(''))

    case 'em':
      return c.italic((token.tokens ?? []).map(t => formatToken(t, c, 0)).join(''))

    case 'codespan':
      return c.cyan(token.text)

    case 'code':
      return (
        c.dim('```' + (token.lang ?? '')) +
        EOL +
        c.yellow(token.text) +
        EOL +
        c.dim('```') +
        EOL + EOL
      )

    case 'blockquote': {
      const inner = (token.tokens ?? []).map(t => formatToken(t, c, 0)).join('')
      return inner
        .split(EOL)
        .map(line => (line.trim() ? c.dim('│ ') + c.italic(line) : line))
        .join(EOL)
    }

    case 'list': {
      const items = (token as Tokens.List).items.map((item: Tokens.ListItem, i: number) => {
        const bullet = token.ordered
          ? c.bold(`${i + 1}.`)
          : c.bold(listDepth === 0 ? '•' : '◦')
        const indent = '  '.repeat(listDepth)
        const inner = (item.tokens ?? []).map((t: Token) => formatToken(t, c, listDepth + 1)).join('').trimEnd()
        return `${indent}${bullet} ${inner}`
      })
      return items.join(EOL) + EOL + EOL
    }

    case 'list_item': {
      return (token.tokens ?? []).map(t => formatToken(t, c, listDepth)).join('')
    }

    case 'hr':
      return c.dim('─'.repeat(40)) + EOL + EOL

    case 'link': {
      const inner = (token.tokens ?? []).map(t => formatToken(t, c, 0)).join('') || token.text
      return c.cyan.underline(inner)
    }

    case 'text':
      if ('tokens' in token && token.tokens) {
        return (token.tokens as Token[]).map(t => formatToken(t, c, 0)).join('')
      }
      return token.text ?? ''

    case 'br':
      return EOL

    case 'space':
      return EOL

    default:
      return (token as { text?: string }).text ?? (token as { raw?: string }).raw ?? ''
  }
}
