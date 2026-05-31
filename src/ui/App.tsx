// 交互式 REPL UI — 使用 React Ink 渲染到终端
// 参考: claude-code-main/src/screens/REPL.tsx + components/App.tsx

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Box, Text, Static, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { query } from '../query'
import { listTools } from '../tools/registry'
import { createUserMessage } from '../types/message'
import type { UserMessage, AssistantMessage } from '../types/message'
import { WelcomePanel } from './WelcomePanel'
import { LoginWizard, formatLoginSuccess } from './LoginWizard'
import type { LoginResult } from './LoginWizard'
import { config, updateProviderConfig, saveConfigToEnv } from '../config'
import { resetAllApiClients } from '../api/stream'
import { getSystemPrompt } from '../context/systemPrompt/builder'
import { onQuestion, answer } from '../tools/AskUserQuestionTool/bridge'
import type { PendingQuestion } from '../tools/AskUserQuestionTool/bridge'
import { setSessionSystemPrompt } from '../services/session-context'
import { startUDSServer } from '../services/uds-server'
import { getState } from '../services/agent-state'
import type { AgentTaskState } from '../services/agent-state'
import { renderMarkdown } from '../utils/markdown'
import { getMode, setMode } from '../state/sessionMode'
import type { SessionMode } from '../state/sessionMode'
import { ModeSelector, MODE_OPTIONS } from './ModeSelector'
import { VigilPanel, VIGIL_ACTIONS } from './VigilPanel'
import { SlashHint, SLASH_COMMANDS } from './SlashHint'
import { ModeSwitchBanner, ModeInputFrame } from './ModeBanner'
import { TodoPanel } from './TodoPanel'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSettings, validateWechatSettings, resolveWechatSettings, resetSettingsCache } from '../settings'
import { abortWechatRead, WechatReadTool } from '../tools/WechatReadTool'

const VIGIL_RESULT_DIR = join(homedir(), '.astraea', 'task-results')

const INDIGO = '#6A5ACD'
const VERSION = '0.1.0'

function formatToolArg(name: string, input: Record<string, unknown>): string {
  const MAX = 120
  let arg: string
  switch (name) {
    case 'Read':
    case 'Write':
      arg = String(input['file_path'] ?? JSON.stringify(input))
      break
    case 'Bash':
    case 'PowerShell':
      arg = String(input['command'] ?? JSON.stringify(input))
      break
    default: {
      const raw = JSON.stringify(input)
      arg = raw.length > MAX ? raw.slice(0, MAX) + '…' : raw
    }
  }
  return arg.length > MAX ? arg.slice(0, MAX) + '…' : arg
}

// ─────────────────────────── 类型 ────────────────────────────────────────────

interface HistoryEntry {
  id: string
  role: 'welcome' | 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'mode_banner'
  text: string
  lines?: string[]  // multi-line result display (tool_result only)
}

// ─────────────────────────── 主组件 ──────────────────────────────────────────

export function App() {
  const { exit } = useApp()

  // history[0] = welcome panel (never changes); rest = conversation entries
  const [history, setHistory] = useState<HistoryEntry[]>([
    { id: 'welcome', role: 'welcome', text: '' },
  ])
  const [streamingText, setStreamingText] = useState('')
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [liveOutput, setLiveOutput] = useState<string>('')
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  // AskUserQuestion: pending question from the model
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  // System prompt loaded asynchronously on mount
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null)
  const [sessionMode, setSessionModeState] = useState<SessionMode>('default')
  const [pendingModeSelect, setPendingModeSelect] = useState(false)
  const [modeSelectorIndex, setModeSelectorIndex] = useState(0)
  const [pendingVigilPanel, setPendingVigilPanel] = useState(false)
  const [vigilPanelIndex, setVigilPanelIndex] = useState(0)
  const [questionOptionIndex, setQuestionOptionIndex] = useState(-1)
  const [vigilInlineValues, setVigilInlineValues] = useState<Record<string, string>>({})

  const conversationRef = useRef<(UserMessage | AssistantMessage)[]>([])
  const entryIdRef = useRef(0)
  const commandHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const draftInputRef = useRef('')

  const modelId = useMemo(() => {
    const p = config.provider
    return p === 'ollama'
      ? config.ollama.model
      : p === 'openai'
        ? config.openai.model
        : p === 'deepseek'
          ? config.deepseek?.model ?? ''
          : config.anthropic.model
  }, [])

  // Load real system prompt on mount and rebuild whenever session mode changes
  // Also start UDS server for cross-process IPC (only on mount)
  useEffect(() => { startUDSServer() }, [])

  // Poll for completed vigil task results and surface them in the REPL
  useEffect(() => {
    const poll = setInterval(() => {
      try {
        const files = readdirSync(VIGIL_RESULT_DIR)
        for (const file of files) {
          if (!file.endsWith('.json')) continue
          const path = join(VIGIL_RESULT_DIR, file)
          let content: { taskId: string; prompt: string; output: string; completedAt: string; read: boolean; failed?: boolean; filesWritten?: string[]; toolErrors?: string[] }
          try { content = JSON.parse(readFileSync(path, 'utf-8')) } catch { continue }
          if (content.read) continue
          // Mark read immediately to prevent double-display
          writeFileSync(path, JSON.stringify({ ...content, read: true }, null, 2))
          const shortPrompt = content.prompt.length > 80 ? content.prompt.slice(0, 80) + '…' : content.prompt
          const header = content.failed
            ? `**[Vigil task failed]** \`${content.taskId.slice(0, 8)}\``
            : `**[Vigil task complete]** \`${content.taskId.slice(0, 8)}\``
          const filesSection = content.filesWritten && content.filesWritten.length > 0
            ? `\n\n**Files written:**\n${content.filesWritten.map(f => `- \`${f}\``).join('\n')}`
            : ''
          const errorsSection = content.toolErrors && content.toolErrors.length > 0
            ? `\n\n**Tool errors:**\n${content.toolErrors.map(e => `- ${e}`).join('\n')}`
            : ''
          setHistory(prev => [...prev, {
            id: String(entryIdRef.current++),
            role: 'assistant' as const,
            text: `${header}\n\n> ${shortPrompt}\n\n${content.output}${filesSection}${errorsSection}`,
          }])
        }
      } catch { /* result dir not yet created */ }
    }, 2_000)
    return () => clearInterval(poll)
  }, [])

  useEffect(() => {
    const tools = listTools()
    const enabledTools = new Set(tools.map(t => t.name))
    getSystemPrompt({ modelId, enabledTools, mode: sessionMode }).then(prompt => {
      setSystemPrompt(prompt)
      setSessionSystemPrompt(prompt)
    }).catch(() => {
      const fallback = 'You are Astraea, an AI coding assistant.'
      setSystemPrompt(fallback)
      setSessionSystemPrompt(fallback)
    })
  }, [modelId, sessionMode])

  // Poll running agents for spinner display
  const [runningAgents, setRunningAgents] = useState<AgentTaskState[]>([])
  useEffect(() => {
    const interval = setInterval(() => {
      const agents = Object.values(getState().tasks).filter(
        (t): t is AgentTaskState => t.kind === 'agent' && t.status === 'running',
      )
      setRunningAgents(agents)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // Subscribe to AskUserQuestion bridge
  useEffect(() => {
    const unsubscribe = onQuestion(q => {
      setPendingQuestion(q)
      setInputValue('')
    })
    return unsubscribe
  }, [])

  // Default cursor to first option whenever a new question arrives
  useEffect(() => {
    setQuestionOptionIndex(pendingQuestion?.options?.length ? 0 : -1)
  }, [pendingQuestion])

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      // AskUserQuestion answer mode: relay to bridge, don't start a new query
      if (pendingQuestion) {
        setInputValue('')
        setPendingQuestion(null)
        // If the user navigated to an option with arrow keys, use that; otherwise use typed text
        const responseText =
          questionOptionIndex >= 0 && pendingQuestion.options?.[questionOptionIndex]
            ? pendingQuestion.options[questionOptionIndex]!
            : trimmed
        setQuestionOptionIndex(-1)
        const entryId = String(entryIdRef.current++)
        setHistory(prev => [...prev, { id: entryId, role: 'user', text: responseText }])
        answer(responseText)
        return
      }

      if (isStreaming) return
      if (!systemPrompt) return  // still loading

      if (trimmed === '/login') {
        setInputValue('')
        historyIndexRef.current = -1
        setShowLogin(true)
        return
      }

      if (trimmed === '/clear') {
        setInputValue('')
        historyIndexRef.current = -1
        conversationRef.current = []
        setHistory([{ id: 'welcome', role: 'welcome', text: '' }])
        return
      }

      if (trimmed === '/help') {
        setInputValue('')
        historyIndexRef.current = -1
        setHistory(prev => [...prev, {
          id: String(entryIdRef.current++),
          role: 'assistant',
          text: [
            '**Available commands:**',
            '',
            '  /mode    — select session mode: orbit · forge · counsel · default',
            '  /vigil   — manage scheduled background tasks: add · list · delete',
            '  /login   — configure API key and provider',
            '  /clear   — clear conversation history',
            '  /help    — show this message',
          ].join('\n'),
        }])
        return
      }

      // /mode <name> — 直接切换到指定模式，零 token 消耗
      const modeArgMatch = trimmed.match(/^\/mode\s+(default|orbit|forge|counsel)$/)
      if (modeArgMatch) {
        const newMode = modeArgMatch[1] as SessionMode
        setInputValue('')
        historyIndexRef.current = -1
        setMode(newMode)
        setSessionModeState(newMode)
        setHistory(prev => [
          ...prev,
          { id: String(entryIdRef.current++), role: 'mode_banner' as const, text: newMode },
        ])
        return
      }

      // /mode — 展示方向键导航选择器，不走 AI，零 token 消耗
      if (trimmed === '/mode') {
        setInputValue('')
        historyIndexRef.current = -1
        // 预设光标停在当前模式
        const currentIdx = MODE_OPTIONS.findIndex(o => o.value === getMode())
        setModeSelectorIndex(currentIdx >= 0 ? currentIdx : 0)
        setPendingModeSelect(true)
        return
      }

      // pendingModeSelect 激活时，文本输入被 useInput 接管，此分支不应触发
      if (pendingModeSelect) return

      // /vigil — 弹出方向键导航面板
      if (trimmed === '/vigil') {
        setInputValue('')
        historyIndexRef.current = -1
        setVigilPanelIndex(0)
        setPendingVigilPanel(true)
        return
      }

      // /wechat — 立即执行微信聊天整理
      if (trimmed === '/wechat') {
        setInputValue('')
        historyIndexRef.current = -1
        resetSettingsCache()                 // 读取最新 settings.json，避免会话内缓存陈旧
        const wechatRaw = getSettings().wechat
        const validErr = validateWechatSettings(wechatRaw)
        if (validErr) {
          setHistory(prev => [...prev,
            { id: String(entryIdRef.current++), role: 'user', text: '/wechat' },
            { id: String(entryIdRef.current++), role: 'assistant', text: `⚠️ 微信整理配置不完整：\n\n${validErr}` },
          ])
          return
        }
        const wechatSettings = resolveWechatSettings(wechatRaw!)
        // Ensure outputDir exists
        if (!existsSync(wechatSettings.outputDir)) {
          mkdirSync(wechatSettings.outputDir, { recursive: true })
        }
        const today = new Date().toISOString().slice(0, 10)
        const outFile = join(wechatSettings.outputDir, `wechat-summary-${today}.md`)
        const scopeDesc = wechatSettings.scope.type === 'contacts'
          ? `指定联系人：${(wechatSettings.scope as { names: string[] }).names.join('、')}`
          : wechatSettings.scope.type === 'top'
            ? `最近 ${(wechatSettings.scope as { k: number }).k} 个联系人`
            : `所有联系人（上限 ${(wechatSettings.scope as { limit: number }).limit}）`

        setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'user', text: '/wechat' }])
        commandHistoryRef.current.push('/wechat')
        setIsStreaming(true); setStreamingText(''); setActiveTool('WechatRead'); setLiveOutput('')

        ;(async () => {
          let acc = ''
          const controller = new AbortController()
          const sigintHandler = () => { controller.abort(); abortWechatRead() }
          process.once('SIGINT', sigintHandler)
          try {
            // ── 1. 确定性收集：直接调用工具，scope/days/contacts/organize 全部来自
            //       settings.json，不交给 LLM 决策（杜绝漏联系人 / 错天数 / 错分类）。
            const collected = await WechatReadTool.call(
              { use_settings: true, wechat_settings: wechatSettings },
              { mode: 'default', abortSignal: controller.signal },
            )
            setActiveTool(null)

            if (collected.isError) {
              setHistory(prev => [...prev,
                { id: String(entryIdRef.current++), role: 'assistant', text: `⚠️ 微信读取失败：\n\n${collected.output}` },
              ])
              setStreamingText(''); setIsStreaming(false)
              return
            }

            // Per-contact coverage — use the actual contact names from settings,
            // NOT regex-parsed ## headers which would also match prompt sections
            // like "背景说明", "原始聊天记录", "整理任务".
            const contactNames: string[] =
              wechatSettings.scope.type === 'contacts'
                ? (wechatSettings.scope as { names: string[] }).names
                : (() => {
                    const m = collected.output.match(/涉及联系人：(.+)/)
                    return m ? m[1]!.split('、').map((s: string) => s.trim()).filter(Boolean) : []
                  })()

            const coverage = contactNames.map(name => {
              const idx = collected.output.indexOf(`## ${name}`)
              if (idx === -1) return { name, ok: false }
              const body = collected.output.slice(idx).split(/\n## /)[0] ?? ''
              const ok = !body.includes('（未找到消息）') && !/\nError:/.test(body) && !body.includes('No text found')
              return { name, ok }
            })

            // ── 2. LLM 只生成摘要正文（不调用任何工具，杜绝"假装写入"）──
            const aiPrompt = [
              `以下是已收集完毕的微信聊天记录与整理指令（范围：${scopeDesc}；最近 ${wechatSettings.days} 天；整理方式：${wechatSettings.organize.join('、')}）。`,
              `请严格按指令生成摘要。**只输出最终 Markdown 正文本身：不要任何前后说明、不要代码围栏。** 联系人名字保持原始中文，不得翻译。`,
              ``,
              collected.output,
            ].join('\n')

            const msgs = [...conversationRef.current, createUserMessage(aiPrompt)]
            for await (const ev of query(msgs, [], { system: systemPrompt!, maxTurns: 1, enablePromptCaching: true })) {
              if (ev.type === 'text') { acc += ev.text; setStreamingText(acc) }
              else if (ev.type === 'done') { conversationRef.current = ev.messages }
            }

            // ── 3. App 层确定性写入 + 校验 + 如实汇报 ──
            const summary = acc.trim()
            let report: string
            if (!summary) {
              report = `✗ 摘要生成为空，未写入文件。原始采集：\n${coverage.map(c => `${c.name}${c.ok ? ' ✓' : ' ✗未找到消息'}`).join('、')}`
            } else {
              try {
                writeFileSync(outFile, summary + '\n', 'utf-8')
                const missing = coverage.filter(c => !c.ok).map(c => c.name)
                report = [
                  `✓ 摘要已写入：${outFile}（${summary.length} 字）`,
                  `联系人覆盖：${coverage.map(c => `${c.name}${c.ok ? ' ✓' : ' ✗未找到消息'}`).join('、')}`,
                  ...(missing.length ? ['', `⚠️ ${missing.join('、')} 未读到内容——可能是 settings.json 里的名字与微信显示不完全一致，或导航/OCR 失败。`] : []),
                ].join('\n')
              } catch (e) {
                report = `✗ 写入失败：${outFile}\n${String(e)}`
              }
            }
            setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'assistant', text: report }])
            setStreamingText(''); setIsStreaming(false)
          } catch { setActiveTool(null); setIsStreaming(false) }
          finally { process.removeListener('SIGINT', sigintHandler) }
        })()
        return
      }

      commandHistoryRef.current.push(trimmed)
      historyIndexRef.current = -1
      setInputValue('')
      setIsStreaming(true)
      setStreamingText('')
      setActiveTool(null)
      setLiveOutput('')

      const userEntryId = String(entryIdRef.current++)
      setHistory(prev => [...prev, { id: userEntryId, role: 'user', text: trimmed }])

      const userMsg = createUserMessage(trimmed)
      const messages = [...conversationRef.current, userMsg]

      let accumulated = ''

      try {
        for await (const event of query(messages, listTools(), {
          system: systemPrompt,
          maxTurns: 20,
          enablePromptCaching: true,
        })) {
          switch (event.type) {
            case 'text':
              accumulated += event.text
              setStreamingText(accumulated)
              break

            case 'tool_use': {
              // TodoWrite 由动态面板展示，不进 Static 历史
              if (event.name === 'TodoWrite') break
              setActiveTool(event.name)
              const argPreview = formatToolArg(event.name, event.input)
              setHistory(prev => [
                ...prev,
                { id: String(entryIdRef.current++), role: 'tool_use', text: `${event.name}(${argPreview})` },
              ])
              break
            }

            case 'tool_progress': {
              setLiveOutput(prev => prev + event.chunk)
              break
            }

            case 'tool_result': {
              setLiveOutput('')
              setActiveTool(null)
              // TodoWrite 结果由动态面板展示，不进 Static 历史
              if (event.name === 'TodoWrite') break
              const tool = listTools().find(t => t.name === event.name)
              const renderedLines = tool?.renderResult?.(event.input, event.output, event.isError) ?? null
              let lines: string[]
              if (renderedLines) {
                lines = event.isError ? [`[error] ${renderedLines[0]}`, ...renderedLines.slice(1)] : renderedLines
              } else {
                const status = event.isError ? 'error' : 'ok'
                const preview = event.output.slice(0, 300)
                lines = [`[${status}] ${preview}${event.output.length > 300 ? '…' : ''}`]
              }

              // ── 检测 AI 工具调用（EnterOrbitMode / ExitOrbitMode）导致的模式变化 ──
              // singleton getMode() 是权威值；React state 可能滞后
              const currentSingletonMode = getMode()
              setSessionModeState(prev => {
                if (prev !== currentSingletonMode) {
                  // 模式变了 → 同步 state，并插入横幅
                  setHistory(h => [
                    ...h,
                    {
                      id: String(entryIdRef.current++),
                      role: 'mode_banner' as const,
                      text: currentSingletonMode,
                    },
                  ])
                  return currentSingletonMode
                }
                return prev
              })

              setHistory(prev => [
                ...prev,
                {
                  id: String(entryIdRef.current++),
                  role: 'tool_result',
                  text: lines[0]!,
                  lines,
                },
              ])
              break
            }

            case 'done':
              conversationRef.current = event.messages
              setHistory(prev => [
                ...prev,
                { id: String(entryIdRef.current++), role: 'assistant', text: accumulated },
              ])
              setStreamingText('')
              setIsStreaming(false)
              break
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        setHistory(prev => [
          ...prev,
          { id: String(entryIdRef.current++), role: 'assistant', text: `[Error: ${errMsg}]` },
        ])
        setStreamingText('')
        setIsStreaming(false)
        setActiveTool(null)
      }
    },
    [isStreaming, systemPrompt, pendingQuestion, pendingModeSelect, pendingVigilPanel, questionOptionIndex],
  )

  const handleLoginDone = useCallback(async (result: LoginResult | null) => {
    setShowLogin(false)
    if (!result) return
    updateProviderConfig(result.provider, result.model, result.apiKey)
    resetAllApiClients()
    await saveConfigToEnv()
    const successText = formatLoginSuccess(result)
    setHistory(prev => [
      ...prev,
      { id: String(entryIdRef.current++), role: 'assistant', text: successText },
    ])
  }, [])

  const handleVigilInlineAction = useCallback((actionKey: string, text: string) => {
    if (!text.trim() || !systemPrompt) return
    const trimmed = text.trim()
    setPendingVigilPanel(false)
    setVigilInlineValues({})

    let userText: string
    let aiPrompt: string

    if (actionKey === 'wechat') {
      // Validate settings before creating the vigil task
      const wechatRaw = getSettings().wechat
      const validErr = validateWechatSettings(wechatRaw)
      if (validErr) {
        setHistory(prev => [...prev,
          { id: String(entryIdRef.current++), role: 'user', text: `/vigil wechat ${trimmed}` },
          { id: String(entryIdRef.current++), role: 'assistant', text: `⚠️ 微信整理配置不完整：\n\n${validErr}` },
        ])
        return
      }
      const wechatSettings = resolveWechatSettings(wechatRaw!)
      userText = `/vigil wechat: ${trimmed}`
      aiPrompt = [
        `用户要创建一个定时微信聊天整理任务，执行时间为：${trimmed}`,
        ``,
        `任务配置（来自 settings.json）：`,
        `  范围：${JSON.stringify(wechatSettings.scope)}`,
        `  时间：最近 ${wechatSettings.days} 天`,
        `  整理方式：${wechatSettings.organize.join('、')}`,
        `  输出目录：${wechatSettings.outputDir}`,
        ``,
        `请使用 VigilOnce 或 VigilSchedule 注册任务，任务 prompt 为：`,
        `"整理微信聊天记录。调用 WechatRead 工具，传入参数 { use_settings: true, wechat_settings: ${JSON.stringify(wechatSettings)} }，`,
        `按返回的指令生成摘要，将结果写入 ${wechatSettings.outputDir}/ 目录下以日期命名的 .md 文件。"`,
        ``,
        `重要：`,
        `- 任务 prompt 中联系人名字必须保持原始中文`,
        `- 如果无法从 "${trimmed}" 中识别出明确的执行时间，请创建失败并说明原因`,
      ].join('\n')
    } else {
      userText = actionKey === 'add' ? trimmed : `/vigil delete ${trimmed}`
      aiPrompt = actionKey === 'add'
        ? `Schedule the following as a background task using VigilOnce (one-time) or VigilSchedule (recurring) — choose based on the user's intent: ${trimmed}`
        : `Delete the scheduled vigil task with ID: ${trimmed}. Use VigilDelete.`
    }

    setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'user', text: userText }])
    commandHistoryRef.current.push(userText)
    setIsStreaming(true); setStreamingText(''); setActiveTool(null); setLiveOutput('')

    const msgs = [...conversationRef.current, createUserMessage(aiPrompt)]
    ;(async () => {
      let acc = ''
      try {
        for await (const ev of query(msgs, listTools(), { system: systemPrompt, maxTurns: 10, enablePromptCaching: true })) {
          if (ev.type === 'text') { acc += ev.text; setStreamingText(acc) }
          else if (ev.type === 'done') {
            conversationRef.current = ev.messages
            setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'assistant', text: acc }])
            setStreamingText(''); setIsStreaming(false)
          }
        }
      } catch { setIsStreaming(false) }
    })()
  }, [systemPrompt])

  useInput((_, key) => {
    if (showLogin) return

    // ── VigilPanel 键盘控制 ───────────────────────────────────────────────────
    if (pendingVigilPanel) {
      if (key.escape) { setPendingVigilPanel(false); return }
      if (key.upArrow) { setVigilPanelIndex(i => (i - 1 + VIGIL_ACTIONS.length) % VIGIL_ACTIONS.length); return }
      if (key.downArrow) { setVigilPanelIndex(i => (i + 1) % VIGIL_ACTIONS.length); return }
      if (key.return) {
        const action = VIGIL_ACTIONS[vigilPanelIndex]
        if (!action) return
        if (action.key === 'list') {
          setPendingVigilPanel(false)
          setVigilInlineValues({})
          setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'user', text: '/vigil list' }])
          setIsStreaming(true); setStreamingText(''); setActiveTool(null); setLiveOutput('')
          const msgs = [...conversationRef.current, createUserMessage('List all scheduled vigil tasks using VigilList.')]
          ;(async () => {
            let acc = ''
            try {
              for await (const ev of query(msgs, listTools(), { system: systemPrompt!, maxTurns: 3, enablePromptCaching: true })) {
                if (ev.type === 'text') { acc += ev.text; setStreamingText(acc) }
                else if (ev.type === 'done') {
                  conversationRef.current = ev.messages
                  setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'assistant', text: acc }])
                  setStreamingText(''); setIsStreaming(false)
                }
              }
            } catch { setIsStreaming(false) }
          })()
        }
        // add / delete: TextInput's onSubmit handles submission — do nothing here
        return
      }
      return
    }

    // ── ModeSelector 键盘控制 ─────────────────────────────────────────────────
    if (pendingModeSelect) {
      if (key.escape) {
        setPendingModeSelect(false)
        return
      }
      if (key.upArrow) {
        setModeSelectorIndex(i => (i - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length)
        return
      }
      if (key.downArrow) {
        setModeSelectorIndex(i => (i + 1) % MODE_OPTIONS.length)
        return
      }
      if (key.return) {
        const selected = MODE_OPTIONS[modeSelectorIndex]
        if (selected) {
          setPendingModeSelect(false)
          setMode(selected.value)
          setSessionModeState(selected.value)
          setHistory(prev => [
            ...prev,
            {
              id: String(entryIdRef.current++),
              role: 'mode_banner' as const,
              text: selected.value,
            },
          ])
        }
        return
      }
      return
    }

    // Tab — 接受 slash 命令补全
    if (key.tab && !isStreaming && !pendingQuestion) {
      const match = SLASH_COMMANDS.find(
        c => c.name.startsWith(inputValue) && c.name !== inputValue && inputValue.startsWith('/'),
      )
      if (match) {
        setInputValue(match.name)
      }
      return
    }

    if (key.escape) {
      if (pendingQuestion) {
        setPendingQuestion(null)
        setInputValue('')
        answer('')
        return
      }
      setInputValue('')
      historyIndexRef.current = -1
      return
    }
    if (isStreaming && !pendingQuestion) return

    // AskUserQuestion option navigation and confirmation
    if (pendingQuestion?.options?.length) {
      if (key.upArrow) { setQuestionOptionIndex(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setQuestionOptionIndex(i => Math.min(pendingQuestion.options!.length - 1, i + 1)); return }
      if (key.return && questionOptionIndex >= 0) {
        const selected = pendingQuestion.options[questionOptionIndex]!
        setInputValue('')
        setQuestionOptionIndex(0)
        setPendingQuestion(null)
        setHistory(prev => [...prev, { id: String(entryIdRef.current++), role: 'user', text: selected }])
        answer(selected)
        return
      }
    }

    if (key.upArrow) {
      const hist = commandHistoryRef.current
      if (hist.length === 0) return
      if (historyIndexRef.current === -1) draftInputRef.current = inputValue
      historyIndexRef.current =
        historyIndexRef.current === -1 ? hist.length - 1 : Math.max(0, historyIndexRef.current - 1)
      setInputValue(hist[historyIndexRef.current]!)
      return
    }
    if (key.downArrow) {
      if (historyIndexRef.current === -1) return
      const hist = commandHistoryRef.current
      if (historyIndexRef.current >= hist.length - 1) {
        historyIndexRef.current = -1
        setInputValue(draftInputRef.current)
      } else {
        historyIndexRef.current++
        setInputValue(hist[historyIndexRef.current]!)
      }
    }
  })

  const toolNames = listTools().map(t => t.name)

  const modelName =
    config.provider === 'ollama'
      ? config.ollama.model
      : config.provider === 'openai'
        ? config.openai.model
        : config.provider === 'deepseek'
          ? config.deepseek?.model ?? ''
          : config.anthropic.model

  const inputFocused = (!isStreaming || pendingQuestion !== null) && !pendingModeSelect && !pendingVigilPanel
  const inputPlaceholder = pendingQuestion
    ? 'Type your answer… (Esc to skip)'
    : isStreaming
      ? 'Waiting for Astraea...'
      : systemPrompt === null
        ? 'Initializing...'
        : 'Message Astraea… (Ctrl+C to exit)'

  // ─────────────────────────── 渲染 ──────────────────────────────────────────

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {entry => {
          if (entry.role === 'welcome') {
            return (
              <WelcomePanel
                key={entry.id}
                version={VERSION}
                cwd={process.cwd()}
                model={modelName}
                tools={toolNames}
              />
            )
          }
          if (entry.role === 'mode_banner') {
            return (
              <ModeSwitchBanner key={entry.id} mode={entry.text as SessionMode} />
            )
          }
          if (entry.role === 'tool_use') {
            return (
              <Box key={entry.id}>
                <Text color="yellow">⏺  {entry.text}</Text>
              </Box>
            )
          }
          if (entry.role === 'tool_result') {
            const displayLines = entry.lines ?? [entry.text]
            return (
              <Box key={entry.id} flexDirection="column" marginLeft={4} marginBottom={1}>
                <Text color="gray" dimColor>⎿  {displayLines[0]}</Text>
                {displayLines.slice(1).map((line, i) => {
                  const isAdded = line.trimStart().startsWith('+')
                  const isRemoved = line.trimStart().startsWith('-')
                  const color = isAdded ? 'green' : isRemoved ? 'red' : 'gray'
                  return (
                    <Text key={i} color={color} dimColor={!isAdded && !isRemoved}>
                      {'   '}{line}
                    </Text>
                  )
                })}
              </Box>
            )
          }
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Text bold color={entry.role === 'user' ? 'green' : INDIGO}>
                {entry.role === 'user' ? 'You' : 'Astraea'}
              </Text>
              <Text>{entry.role === 'assistant' ? renderMarkdown(entry.text) : entry.text}</Text>
            </Box>
          )
        }}
      </Static>

      {isStreaming && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={INDIGO}>Astraea</Text>
          {streamingText ? (
            <Text>{renderMarkdown(streamingText)}</Text>
          ) : (
            <Text color="gray" dimColor>✦ Thinking...</Text>
          )}
          {activeTool && (
            <Box flexDirection="column">
              <Text color="yellow">⏺  {activeTool}…</Text>
              {liveOutput && (
                <Box flexDirection="column" marginLeft={4}>
                  {liveOutput.trimEnd().split('\n').slice(-20).map((line, i) => (
                    <Text key={i} color="gray" dimColor>⎿  {line}</Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Background agent spinners — shown even when main agent is idle */}
      {runningAgents.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {runningAgents.map(agent => (
            <Box key={agent.id}>
              <Text color="cyan">⟳  [{agent.id}] {agent.description}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* AskUserQuestion prompt */}
      {pendingQuestion && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={INDIGO} paddingX={1}>
          <Text bold color={INDIGO}>Astraea asks:</Text>
          <Text>{pendingQuestion.question}</Text>
          {pendingQuestion.options && pendingQuestion.options.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {pendingQuestion.options.map((opt, i) => {
                const isSelected = i === questionOptionIndex
                return (
                  <Text key={i} color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                    {isSelected ? ' ❯ ' : '   '}{opt}
                  </Text>
                )
              })}
              <Text color="gray" dimColor>↑↓ select · Enter confirm</Text>
            </Box>
          )}
        </Box>
      )}

      {showLogin && <LoginWizard onDone={handleLoginDone} />}

      {/* ModeSelector — 方向键导航，覆盖输入框 */}
      {pendingModeSelect && (
        <ModeSelector
          currentMode={sessionMode}
          selectedIndex={modeSelectorIndex}
        />
      )}

      {/* VigilPanel — 定时任务操作选择 */}
      {pendingVigilPanel && (
        <VigilPanel
          selectedIndex={vigilPanelIndex}
          inlineValues={vigilInlineValues}
          onInlineChange={(key, value) => setVigilInlineValues(prev => ({ ...prev, [key]: value }))}
          onInlineSubmit={handleVigilInlineAction}
        />
      )}

      <TodoPanel />

      {!showLogin && !pendingModeSelect && !pendingVigilPanel && (
        <ModeInputFrame mode={sessionMode}>
          <SlashHint input={inputValue} />
          <Box>
            <Text bold color={inputFocused && !isStreaming ? INDIGO : pendingQuestion ? 'yellow' : 'gray'}>
              {pendingQuestion ? '? ' : isStreaming ? '  ' : '✦ '}
            </Text>
            <TextInput
              value={inputValue}
              onChange={val => {
                historyIndexRef.current = -1
                setInputValue(val)
              }}
              onSubmit={handleSubmit}
              focus={inputFocused}
              placeholder={inputPlaceholder}
            />
          </Box>
        </ModeInputFrame>
      )}
    </Box>
  )
}
