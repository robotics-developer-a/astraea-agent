// detectLongTask — 廉价的本地启发式，判断一条用户消息是否值得自动切入 counsel 模式。
//
// 设计取向（见 reason-command-and-team-workflow 记忆 + counsel 双闸）：
//   宁可漏判，不可误判到「贴一段长日志就被拦下来问问题」。因此三条触发任一命中即可，
//   但都偏向「用户在派发一个需要决策的工程任务」这一信号，而非单纯的长度。
//   命中后仍由模型决定问几道题（trivial 任务可只问一道确认题，甚至直接干）。

// 触发关键词：明确表达「要动手改造系统」的动词。中英双语。
const IMPERATIVE = /(实现|重构|重新设计|重设计|迁移|搭建|设计一套|架构|接入|集成|做一个|开发|新增模块|refactor|implement|migrate|redesign|architect|build (a|an|the)|integrate|scaffold)/i

// 主观结果或泛化改进动词，但没有可验收的具体目标。此类请求应先询问用户。
const SUBJECTIVE_OUTCOME = /(美观|好看|漂亮|更好|更舒服|更专业|高级感|现代化)(一点|一些|些|一下)?|\b(better|nicer|prettier|more polished|more professional)\b/i
const VAGUE_IMPROVEMENT = /^(?:请)?(?:帮我)?(?:把)?(?:优化|改进|改善|完善|调整|处理|润色|美化|升级)(?:一下|一些|下|点|一遍)?(?:这个|那个|当前|现有|整个)?(?:\s*(?:页面|界面|UI|设计|代码|功能|项目|系统|流程))?[\s。！？!?]*$|^(?:please\s+)?(?:improve|polish|enhance|clean up)(?:\s+(?:this|the|current))?(?:\s+(?:page|ui|design|code|feature|project|system|flow))?[\s.!?]*$/i

export interface LongTaskSignal {
  long: boolean
  reason: 'length' | 'multiline' | 'keyword' | null
}

export interface CounselTaskSignal {
  counsel: boolean
  reason: LongTaskSignal['reason'] | 'ambiguous'
}

/**
 * 判断 text 是否构成一个「长任务」。
 * - length:   去除空白后 ≥ 280 字（CJK 一字顶多个 token，阈值偏保守）
 * - multiline: 非空行 ≥ 4（多半是带清单/分步的需求）
 * - keyword:  命中工程改造动词
 */
export function detectLongTask(text: string): LongTaskSignal {
  const trimmed = text.trim()
  // 斜杠命令、@提及之类一律不算任务派发
  if (!trimmed || trimmed.startsWith('/')) return { long: false, reason: null }

  if (IMPERATIVE.test(trimmed)) return { long: true, reason: 'keyword' }

  const nonEmptyLines = trimmed.split('\n').filter(l => l.trim().length > 0)
  if (nonEmptyLines.length >= 4) return { long: true, reason: 'multiline' }

  const dense = trimmed.replace(/\s+/g, '')
  if (dense.length >= 280) return { long: true, reason: 'length' }

  return { long: false, reason: null }
}

/** Decide whether a request needs pre-execution consultation. */
export function detectCounselTask(text: string): CounselTaskSignal {
  const longTask = detectLongTask(text)
  if (longTask.long) return { counsel: true, reason: longTask.reason }

  const trimmed = text.trim()
  if (SUBJECTIVE_OUTCOME.test(trimmed) || VAGUE_IMPROVEMENT.test(trimmed)) {
    return { counsel: true, reason: 'ambiguous' }
  }

  return { counsel: false, reason: null }
}
