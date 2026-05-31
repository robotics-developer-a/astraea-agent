# 阶段一学习笔记 - 2026-05-20

## 今日目标
- [x] 初始化 bun 项目，安装 @anthropic-ai/sdk
- [x] 实现 src/config.ts — API key 配置
- [x] 实现 src/types/message.ts — 基础消息类型
- [x] 实现 src/api/client.ts — Anthropic client 初始化
- [x] 实现 src/api/stream.ts — 流式调用封装
- [x] 实现 src/cli.ts — 最小 CLI

## 源码精读

### claude-code-main/src/services/api/client.ts
- 原版支持多 provider：Direct API / AWS Bedrock / Vertex AI / Azure Foundry
- 我们简化为只支持 Direct API（ANTHROPIC_API_KEY）
- 原版有复杂的 OAuth token 刷新逻辑，我们省略

### claude-code-main/src/services/api/claude.ts
- 原版用 `anthropic.beta.messages.stream()`（beta API）
  - 支持扩展 beta 头：thinking、fast mode、AFK mode 等
  - 我们用标准 `anthropic.messages.stream()`，功能等价
- 流式事件处理核心：
  - `content_block_start` → 记录当前 block 类型和 ID
  - `content_block_delta` → text 直接 yield；input_json 拼接到 buffer
  - `content_block_stop` → tool_use block 完成，emit 完整工具调用
  - `message_stop` → 调用 `stream.finalMessage()` 取 usage 统计

## 关键实现点

### Prompt Caching
```typescript
// 系统提示加 cache_control，命中后省约 90% input token 费用
{
  type: 'text',
  text: systemPromptText,
  cache_control: { type: 'ephemeral' }  // 缓存 5 分钟
}
```
- `ephemeral` 缓存生存 5 分钟，同一个 API key 的请求共享缓存
- 系统提示超过约 1024 tokens 才有缓存意义（有最小长度要求）

### tool_use 的 input 是流式 JSON
```
content_block_start  → { type: 'tool_use', id, name }
content_block_delta  → { type: 'input_json_delta', partial_json: '{"cmd' }
content_block_delta  → { type: 'input_json_delta', partial_json: '": "ls"}' }
content_block_stop   → 此时 buffer = '{"cmd": "ls"}', JSON.parse → input
```

### toAPIMessage() 的设计原则
内部 Message 类型和 API MessageParam 类型分开 → 方便后续给内部 Message 加额外字段
（比如：渲染 ID、时间戳、是否被压缩等）

## 与原版的差异
- 简化了：多 provider 支持（只保留 Direct API）
- 简化了：beta messages API（用标准 messages API）
- 简化了：OAuth / AWS SigV4 / GCP 认证
- 原版还有：请求指纹计算（fingerprint.ts）、费用追踪（cost-tracker.ts）

## 阶段二计划
- 完整 message 类型系统（ToolUseMessage、SystemMessage 等）
- normalizeMessagesForAPI() — 把 tool_use + tool_result 配对转换
- createToolResult() 工具函数
