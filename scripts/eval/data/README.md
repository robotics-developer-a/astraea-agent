# Eval 查询数据集（actionability）

`queries.jsonl` —— 28 条覆盖 Astraea 各能力的查询（编码 / 调试 / 重构 / 文件操作 / how-to /
Web 检索 / 规划 / 解释 / 通用 / 故意含糊），用来批量产生 trace，再用 **actionability** 评估器评分。
故意混入 `vague` 类（"帮帮我"这种），好让分数有高低区分。

格式：每行 `{"id","category","query"}`。

## 端到端流程

```bash
# 0) 确保 Phoenix 在跑 + 追踪已开（settings.json 里 PHOENIX_ENABLED=1，已永久配置）
uvx --from arize-phoenix phoenix serve     # 另开一个终端

# 1) 批量跑 query → 产生 trace（在 astraea 根目录）
cd astraea
bun run scripts/eval/run-queries.ts --limit=5     # 先跑 5 条试水
bun run scripts/eval/run-queries.ts               # 跑全部（有 token 花费/耗时）

# 2) 评这些 trace 的「可执行性」
bun run scripts/eval/eval-traces.ts --last-only --eval=actionability --limit=100          # 预览（终端看 label + explanation）
bun run scripts/eval/eval-traces.ts --last-only --eval=actionability --limit=100 --write  # 回写 Phoenix

# 3) 去 localhost:6006，project=astraea，按 actionability 分数排序/筛选，读 explanation
```

## 说明
- `--last-only`：每条 trace 只评最后一个 LLM span（≈ Astraea 的最终答复），actionability 评的就是它。
- 评估器 rubric 在 `scripts/eval/evaluators/actionability.ts`，标签 `actionable(1) / partially_actionable(0.5) / not_actionable(0)`，可自行调 rubric。
- 想自己加 query：往 `queries.jsonl` 追加一行即可。
