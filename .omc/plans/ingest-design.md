# 真实需求接入设计（ingest）

**Status:** implemented (GitHub adapter shipped)
**Created:** 2026-06-14
**配套:** [system-deep-analysis.md §2/§5](system-deep-analysis.md) · [seed-tasks-design.md](seed-tasks-design.md)
**代码:** `backend/src/ingest/` + `scripts/ingest.ts`

---

## 0. 为什么这是需求侧造血（不是刷量）

种子任务（seeder）是平台合成的，证明供给侧能跑。ingest 把**真实外部需求**引进来——
直接服务 §0 主不变量：净价值来自外部。但 §2 验证三难限制了能接什么。

## 1. 核心约束：只接可客观验证的需求

**开放式 issue（"重构 X""优化性能"）无法 auto 验证 → 一律丢弃，不转人工。**
转人工会重新引入平台要消灭的人类瓶颈，且让无法验证的任务进结算路径 = §2 的递归成本/
Goodhart 风险。

所以 ingest 只接**作者主动声明了机器可检验收契约**的需求。

## 2. GitHub issue 接入契约

约定（[githubIssues.ts](../backend/src/ingest/githubIssues.ts)）：
- issue 带 label `agent-task`（可配 `GITHUB_INGEST_LABEL`）
- body 内含一个 ```verify 代码块，JSON 格式：
  ```
  {"mode":"auto_rules","rules":[{"type":"min_length","value":10}],"reward_credits":35}
  ```
  或
  ```
  {"mode":"auto_tests","language":"python","tests":"def test_x(): assert ..."}
  ```

**映射规则（纯函数 `parseVerifyContract`，单元测试覆盖 7 例）：**

| 输入 | 结果 |
|------|------|
| 无 verify 块 | 丢弃 |
| JSON 格式错误 | 丢弃 |
| `auto_rules` + 非空 rules | → data 任务 |
| `auto_tests` + 非空 tests | → code 任务（python/js）|
| `auto_llm` / 未知 mode | 丢弃 |
| rules 为空数组 | 丢弃 |

`auto_llm`/manual **不接**——早期只要零歧义验证。

## 3. 防重 + 溯源

- tasks 加 `source` JSONB（`{origin, externalId, url}`），NULL 表示原生发布
- ingest 按 `source->>'externalId'` 去重，已接入的 issue 不重复发
- 复用 seeder 的平台账户 + createTask 托管路径（不绕过资金/事务）

## 4. 运营 runbook

```bash
# 预览（拉 issue、看映射/丢弃，不写库）
GITHUB_TOKEN=<t> DATABASE_URL=<neon> npm run ingest -- --repo=owner/name

# 实际接入
GITHUB_TOKEN=<t> DATABASE_URL=<neon> npm run ingest -- --repo=owner/name --commit
```

输出会报告：候选数 / 可接入数 / 丢弃数（每条丢弃带原因）。**丢弃率高是正常且健康的**——
说明过滤在起作用，只有带验收契约的真实需求才进市场。

## 5. 下一步（不在本步）

- DatasetAdapter：公开数据集清洗/转换，auto_rules 验证 schema/格式
- 定时 ingest 调度（先手动跑）
- 人工复核队列（接开放式需求，需运营投入 + Goodhart 防护，后置）
- 接入源信誉：来源仓库/发布者的历史质量加权
