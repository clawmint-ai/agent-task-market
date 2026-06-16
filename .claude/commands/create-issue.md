# 创建 Linear Issue

根据用户描述的需求，在 Clawmint team 的 Agent Task Market 项目中创建一条符合规范的 Linear issue。

## 输入

用户需求描述: $ARGUMENTS

## 执行流程

1. 理解用户需求，确定这条 issue 要交付什么
2. 阅读相关源码确认路径、字段名、现有实现，确保 issue 引用的内容真实存在
3. 调用 `mcp__linear__save_issue` 创建 issue

## Issue 格式要求

### 标题
- 中文
- 动词开头，陈述交付物而非活动
- 50 字以内，不含 issue 编号
- ✅「落地 RemoteRiskEngine HTTP 客户端」 ❌「研究 risk engine」

### 正文（必填四节）

```markdown
## 目标
一句话：做完后世界有什么不同。

## 背景
- 现状是什么（引用代码路径或设计文档）
- 为什么需要做这件事

## 范围
- 具体要新增/修改的文件路径（精确到目录层级）
- 涉及的环境变量 / 配置
- 测试要求

## 完成标准
- 可观测的验收条件（命令 + 期望输出）
- 每条标准必须能被一条命令或一次操作验证
```

## 代码路径约束

「范围」中引用的路径必须对应项目实际结构：

| 层 | 路径 | 职责 | DB 依赖 |
|---|---|---|---|
| domain | `backend/src/domain/` | 纯函数业务逻辑（settlement、credits、reputation、rateLimit、metrics） | 禁止 |
| services | `backend/src/services/` | 编排层（accountService、metricsService、reconcileService、reputationService、verificationService） | 允许 |
| risk | `backend/src/risk/` | 开源/闭源接缝（types.ts 接口、noop.ts、remote.ts） | 仅 fetch |
| runtime | `backend/src/runtime/` | 运行时基础设施（sandbox、verifier、logger、maintenance、notifier、queue、workflow） | 允许 |
| routes | `backend/src/routes/` | HTTP 路由（accounts、tasks、admin、events、metrics） | 通过 service |
| middleware | `backend/src/middleware/` | 横切关注（auth、rateLimit） | 禁止 |
| ingest | `backend/src/ingest/` | 外部源吸纳（githubIssues.ts、types.ts） | 允许 |
| db | `backend/src/db/` | 连接池 + schema（pool.ts、types.ts、schema.pg.sql） | — |
| MCP | `mcp-server/src/` | MCP 协议层（index.ts、tools.ts） | 通过 HTTP |

## 数据模型

涉及数据表时必须引用真实字段名：

- `accounts` — id, type(human|agent), earned_balance, gift_balance, reputation_score, compute_source, api_key_hash, is_active, metadata
- `tasks` — id, publisher_id, reward_credits, escrow_gift, escrow_earned, status(open|claimed|submitted|completed|failed|cancelled), verification(JSONB, mode: manual|auto_rules|auto_tests|auto_llm), source(JSONB), min_reputation, deadline, max_executors, tags
- `task_executions` — id, task_id, executor_id, status(in_progress|submitted|accepted|rejected), result, result_metadata(JSONB), verification_detail(JSONB), score, feedback
- `credit_ledger` — 不可变资金流水，每次 balance 变动留一行

## 风控接缝

涉及 risk-engine 的 issue 须注明失败语义：
- register / publish / claim → **fail-open**（引擎挂了放行）
- onFinalize (accepted) → **fail-closed**（引擎挂了不结算）

## 测试约束

| 类型 | 路径 | DB | 命令 |
|---|---|---|---|
| 单测 | `backend/test/unit/*.test.ts` | 禁止，仅 domain/ 或 mock | `node --import tsx --test test/unit/*.test.ts` |
| 集成 | `backend/test/integration/*.test.ts` | 需 DATABASE_URL | `npm run test:integration` |
| MCP e2e | `mcp-server/scripts/mcp-e2e.mjs` | 需 backend+mcp | `node mcp-server/scripts/mcp-e2e.mjs` |
| 飞轮 proof | `mcp-server/scripts/flywheel-proof.mjs` | 需 backend+mcp | `cd mcp-server && npm run proof` |

完成标准必须指明用哪级测试验证：
- 改 `src/domain/` → 至少单测
- 影响资金流（settlement / escrow）→ 必须集成测试
- 影响 MCP 工具行为 → 必须 MCP e2e

## 环境变量

新增环境变量时须写明：
1. 变量名 + 默认值 + 用途
2. 同步更新 `.env.example`（根目录）和 `backend/.env.example`
3. 敏感值注明生产环境用 secret manager

## 标签（必选其一）

`backend` · `mcp` · `risk` · `ops` · `security` · `docs` · `demand`

## 优先级

| 值 | 含义 |
|---|---|
| 1 (Urgent) | 阻塞其他工作或有安全风险 |
| 2 (High) | 里程碑关键路径 |
| 3 (Medium) | 计划内、非阻塞 |
| 4 (Low) | nice-to-have |

## 里程碑（按 issue 归属选择）

- `M1 — 公开发布准备就绪` — 凭据、CI、docker 验证、文档
- `M2 — 风控引擎接入` — RemoteRiskEngine、risk-engine 服务、hook 集成测试
- `M3 — 需求侧验证` — 外部 publisher、定价、GitHub ingest
- `M4 — 规模化与运维` — TLS、Redis 限流、Grafana、覆盖率

## 禁止

- 没有「完成标准」
- 引用不存在的文件路径或字段名
- 用「调研」「讨论」作为交付物（调研出 document → 那 document 就是交付物）
- 跨越多个独立交付物的超大 issue（必须拆）
- 修改 domain/ 层却不配单测

## 调用参数

创建时使用以下固定参数：
- team: "Clawmint"
- project: "1c1cc894-6eed-4fdf-907a-a122584a5062"
- assignee: "me"
