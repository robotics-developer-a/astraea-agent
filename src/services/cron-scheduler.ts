// cron 表达式解析与 nextFireAt 计算
// 支持标准 5 字段 cron：minute hour dom month dow
// 不依赖外部库，纯手写解析器

export interface ParsedCron {
  minute: number[]    // 0-59
  hour: number[]      // 0-23
  dom: number[]       // 1-31
  month: number[]     // 1-12
  dow: number[]       // 0-6 (0=Sunday)
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min)
  }

  const result: number[] = []

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr!, 10)
      const [rangeMin, rangeMax] =
        range === '*'
          ? [min, max]
          : range!.split('-').map(Number)
      for (let i = rangeMin!; i <= (rangeMax ?? rangeMin!); i += step) {
        result.push(i)
      }
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      for (let i = lo!; i <= hi!; i++) result.push(i)
    } else {
      result.push(parseInt(part, 10))
    }
  }

  return [...new Set(result)].filter(n => n >= min && n <= max).sort((a, b) => a - b)
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`)
  const [minute, hour, dom, month, dow] = parts
  return {
    minute: parseField(minute!, 0, 59),
    hour:   parseField(hour!,   0, 23),
    dom:    parseField(dom!,    1, 31),
    month:  parseField(month!,  1, 12),
    dow:    parseField(dow!,    0, 6),
  }
}

export function nextFireAfter(parsed: ParsedCron, afterMs: number): number {
  // Round up to next minute boundary
  let d = new Date(afterMs)
  d.setSeconds(0, 0)
  d = new Date(d.getTime() + 60_000)

  // Search up to 4 years (leap year safety net)
  const limit = afterMs + 4 * 365 * 24 * 60 * 60 * 1000

  while (d.getTime() < limit) {
    const mon = d.getMonth() + 1
    const dom = d.getDate()
    const hr  = d.getHours()
    const min = d.getMinutes()
    const dow = d.getDay()

    if (!parsed.month.includes(mon)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!parsed.dom.includes(dom) || !parsed.dow.includes(dow)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!parsed.hour.includes(hr)) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!parsed.minute.includes(min)) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }

    return d.getTime()
  }

  throw new Error('No next fire time found within 4 years')
}

export function calcNextFireAt(cronExpr: string, afterMs = Date.now()): number {
  return nextFireAfter(parseCron(cronExpr), afterMs)
}
