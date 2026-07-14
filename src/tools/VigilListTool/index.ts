// VigilListTool — 列出所有定时任务
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { readTasks } from '../../utils/vigilTasks.js'

export const VigilListTool = buildTool({
  name: 'VigilList',
  description: `List all scheduled vigil tasks with their next fire times and IDs.`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },

  async call(_input, _ctx: ToolContext): Promise<ToolCallResult> {
    const tasks = readTasks()

    if (tasks.length === 0) {
      return { output: 'No vigil tasks scheduled.' }
    }

    const lines = [`${tasks.length} task(s) scheduled:`, '']
    for (const t of tasks) {
      const nextFire = new Date(t.nextFireAt).toLocaleString()
      const lastFire = t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : 'never'
      lines.push(`• ${t.description}`)
      lines.push(`  ID:         ${t.id}`)
      lines.push(`  Type:       ${t.recurring ? 'recurring' : 'one-time'}`)
      // VigilOnce 任务没有 cron 字段，不打印 "Cron: undefined"
      if (t.cron) lines.push(`  Cron:       ${t.cron}`)
      lines.push(`  Next fire:  ${nextFire}`)
      lines.push(`  Last fired: ${lastFire}`)
      lines.push('')
    }

    return { output: lines.join('\n').trimEnd() }
  },

  renderResult(_input, output, isError) {
    if (isError) return null
    const tasks = readTasks()
    if (tasks.length === 0) return ['No vigil tasks scheduled.']
    return [
      `${tasks.length} vigil task(s):`,
      ...tasks.map(t => `  • ${t.description} — next: ${new Date(t.nextFireAt).toLocaleString()}`),
    ]
  },
})
