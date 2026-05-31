// 全局配置 — 从环境变量读取，不硬编码敏感值
//
// 加载优先级（低 → 高，高优先级覆盖低优先级）：
//   1. ~/.astraea/.env      — 用户个人全局 secrets（API key 放这里，一次配置所有项目生效）
//   2. <project>/.env       — 项目级覆盖（开发调试用，勿提交 key）
//   3. shell 环境变量        — 最高优先级
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const envPath = join(__dirname, '..', '.env')
export const globalEnvPath = join(homedir(), '.astraea', '.env')

function loadEnvFile(path: string): void {
  try {
    const lines = readFileSync(path, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      // 不覆盖已存在的值（shell 环境变量 > 项目 .env > 全局 .env）
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // 文件不存在则跳过
  }
}

// 加载顺序：项目 .env 先于全局 .env。
// loadEnvFile 用 !(key in process.env) 跳过已存在的值，所以：
//   shell 环境变量（已在 process.env）> 项目 .env > ~/.astraea/.env
loadEnvFile(envPath)       // 先加载项目级，让项目值先占位
loadEnvFile(globalEnvPath) // 再加载全局，只填入项目和 shell 都没有的 key

export type Provider = 'anthropic' | 'deepseek' | 'ollama' | 'openai'

function detectProvider(): Provider {
  const raw = process.env.PROVIDER?.toLowerCase()
  if (raw === 'ollama') return 'ollama'
  if (raw === 'openai') return 'openai'
  if (raw === 'deepseek') return 'deepseek'
  return 'anthropic'
}

export const config = {
  provider: detectProvider() as Provider,

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    maxTokens: 8192,
  },

  // DeepSeek — OpenAI-compatible API
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    maxTokens: 8192,
  },

  // Ollama（本地）
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    maxTokens: 8192,
  },

  // OpenAI（云端）
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    maxTokens: 8192,
  },
}

export function assertConfig(): void {
  if (config.provider === 'anthropic' && !config.anthropic.apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set (or run /login)')
    process.exit(1)
  }
  if (config.provider === 'deepseek' && !config.deepseek.apiKey) {
    console.error('Error: DEEPSEEK_API_KEY is not set (or run /login)')
    process.exit(1)
  }
  if (config.provider === 'openai' && !config.openai.apiKey) {
    console.error('Error: OPENAI_API_KEY is not set (or run /login)')
    process.exit(1)
  }
}

export function updateProviderConfig(provider: Provider, model: string, apiKey: string): void {
  config.provider = provider
  switch (provider) {
    case 'anthropic':
      config.anthropic.apiKey = apiKey
      config.anthropic.model = model
      break
    case 'deepseek':
      config.deepseek.apiKey = apiKey
      config.deepseek.model = model
      break
    case 'openai':
      config.openai.apiKey = apiKey
      config.openai.model = model
      break
  }
}

export async function saveConfigToEnv(): Promise<void> {
  const content = [
    '# ─── Provider 选择 ───────────────────────────────────────',
    `PROVIDER=${config.provider}`,
    '',
    '# ─── Anthropic ──────────────────────────────────────────',
    `ANTHROPIC_API_KEY=${config.anthropic.apiKey}`,
    `ANTHROPIC_MODEL=${config.anthropic.model}`,
    '',
    '# ─── DeepSeek ───────────────────────────────────────────',
    `DEEPSEEK_API_KEY=${config.deepseek.apiKey}`,
    `DEEPSEEK_MODEL=${config.deepseek.model}`,
    '',
    '# ─── Ollama（本地）────────────────────────────────────────',
    `# OLLAMA_BASE_URL=${config.ollama.baseUrl}`,
    `# OLLAMA_MODEL=${config.ollama.model}`,
    '',
    '# ─── OpenAI ─────────────────────────────────────────────',
    `OPENAI_API_KEY=${config.openai.apiKey}`,
    `OPENAI_MODEL=${config.openai.model}`,
    `OPENAI_BASE_URL=${config.openai.baseUrl}`,
    '',
  ].join('\n')
  await Bun.write(envPath, content)
}
