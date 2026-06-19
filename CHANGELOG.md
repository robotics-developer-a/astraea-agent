# Changelog

本文件记录 Astraea 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/) 与
[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号的权威来源是 `package.json` 的 `version` 字段；UI 显示（`src/ui/App.tsx` 的 `VERSION`）
直接读取它，请勿在别处硬编码版本号。

> **1.0.0 发布门槛**（达成后才从 0.x 升到 1.0 并打首个 `git tag v1.0.0`）：

## [0.9.0] - 2026-06-19

首个对外标定版本，纠正长期占位的 `0.1.0`（该值从未随功能更新）。v1.0 的 RC 高度：
设计 ~85% 已实现，但项目仍 private、内部接口仍在演进，故停留在 0.x。

### 已具备
- 40+ 内置工具：文件 / Shell / Web / Task / MCP / 子 agent 协调
- 完整 ReAct 查询循环（多轮流式 + /goal 自驱 Stop-hook）
- 多 Provider：Anthropic / OpenAI / DeepSeek / Ollama + 自适应重试
- 四层上下文压缩：snipping / microcompact / eclipse 折叠 / autocompact
- 文件级持久记忆系统：抽取 / 召回 / 注入
- 5 模式 × 行为权限矩阵 + 红线 + AI 命令分类器
- Skills / Plugins(本地市场) / MCP(stdio·http·sse) 三套体系
- Phoenix 可观测性（span 生命周期 + 离线 eval）
- 196 个测试文件
