// Read 闸门的纯函数（方案 A / §A.1 / §5-#4）
// 参考源码: claude-code-main 的 FileReadTool/limits.ts —— 但 token 上限改为模型自适应。
import { activeContextWindow } from '../../config'

// ── §A.1 模型自适应单读上限 ──────────────────────────────────────────────
// 单条 tool_result 不应吃掉超过窗口的一个小比例，并夹在 [FLOOR, CEIL] 之间，
// 兜住「窗口过小」与「窗口过大反而放纵」两头。三常量为内部调参，不开放给用户配。
export const READ_TOKEN_RATIO = 0.06
export const READ_TOKEN_FLOOR = 4_000
export const READ_TOKEN_CEIL = 25_000

export function computeReadMaxTokens(contextWindow: number): number {
  return Math.min(
    READ_TOKEN_CEIL,
    Math.max(READ_TOKEN_FLOOR, Math.floor(contextWindow * READ_TOKEN_RATIO)),
  )
}

// 随当前激活 provider 的窗口现算（系统自适应，零用户配置）。
export function readMaxTokens(): number {
  return computeReadMaxTokens(activeContextWindow())
}

// ── 体积闸门（读前，env 可覆盖；每次现读 env 以便测试与运行时调整）──────────
function envInt(key: string, fallback: number): number {
  const raw = Number(process.env[key])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

export const readSoftMaxBytes = () => envInt('ASTRAEA_READ_MAX_SIZE_BYTES', 262_144) // 256KB
export const readHardMaxBytes = () => envInt('ASTRAEA_READ_HARD_MAX_SIZE_BYTES', 50 * 1024 * 1024) // 50MB
export const readDefaultLineLimit = () => envInt('ASTRAEA_READ_DEFAULT_LINE_LIMIT', 2_000)

// 返回错误文案（约 100 字节，引导模型自我纠偏）或 null（放行）。
export function checkFileSize(sizeBytes: number, hasExplicitLimit: boolean): string | null {
  // §5-#4: 硬上限无条件生效，即使传了 limit —— 因为 FileReadTool 仍整本读入内存。
  const hard = readHardMaxBytes()
  if (sizeBytes > hard) {
    return `File too large (${sizeBytes} bytes, hard limit ${hard}). `
      + `Use Grep/search to locate what you need, or split the file before reading.`
  }
  const soft = readSoftMaxBytes()
  if (sizeBytes > soft && !hasExplicitLimit) {
    return `File too large (${sizeBytes} bytes, limit ${soft}). `
      + `Use the offset and limit parameters to read a specific range, `
      + `or use Grep/search to locate the part you need.`
  }
  return null
}

// ── 输出 token 闸门（读后）────────────────────────────────────────────────
export function checkTokenBudget(estimatedTokens: number, maxTokens: number): string | null {
  if (estimatedTokens > maxTokens) {
    return `File content (~${estimatedTokens} tokens) exceeds the per-read limit (${maxTokens} tokens). `
      + `Use the offset and limit parameters to read a specific range, `
      + `or use Grep/search to locate the part you need instead of reading the whole file.`
  }
  return null
}
