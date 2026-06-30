# 技术选型评估与分期迁移策略

**Status:** analysis (pending approval)
**Created:** 2026-06-14
**配套:** [global-task-market-roadmap.md](global-task-market-roadmap.md) §技术栈总结 · [code-audit-v1.md](code-audit-v1.md)

---

## 0. 核心原则：接缝先行，实现后置

矛盾：beta 要**低成本**验证需求，商业化要**高可靠**底座。直接上商业化栈 = 为不存在的
规模付运维税；直接用最省的栈 = 日后重写。

**唯一解：所有"重组件"在 beta 期用廉价实现，但都藏在一个稳定接口后面。** 迁移时替换
实现，调用方代码不动。这把"重写风险"降为"换适配器"。

```
调用方 → [ 稳定接口 ] → beta 廉价实现   ──迁移──▶  商业化目标实现
                          (Postgres/进程内)         (Temporal/独立服务)
```

判断一个 beta 决策是否安全，只问一句：**换成目标实现时，调用方要改吗？** 不用改 = 安全省钱；要改 = 是债。

---

## 1. 分组件：beta 廉价实现 → 接缝 → 商业化目标

| 组件 | beta 廉价实现（低成本） | 迁移接缝（关键） | 商业化目标 | 迁移代价 |
|------|----------------------|----------------|-----------|---------|
| **DB** | 单个 managed Postgres（Neon/Supabase 免费档或 ~$0-20/mo） | 从一开始就用 Postgres 方言 + SQL migrations | Postgres HA + PITR + read replica | 仅扩容/加副本，零代码改动 |
| **DB 访问** | Kysely（轻、类型安全、显式 SQL） | 仓储层封装查询，不在 route 里写 SQL | 同 Kysely，加读写分离 | 加 replica 路由，局部 |
| **账本** | Postgres 追加式双分录 + balance projection | 余额只能从 ledger 重放得出，禁止直接改余额字段 | 同结构，加冻结/pending/对账 job | 纯增量加列，零重构 |
| **资金长流程** | **Postgres outbox + 状态机表 + cron reconciler** | `WorkflowRunner` 接口（start/step/resume） | Temporal | 实现 RemoteWorkflowRunner，换工厂 |
| **轻队列/通知** | 进程内定时器 + Postgres 队列表 | `Queue` 接口（enqueue/process） | Redis + BullMQ | 换 Queue 实现 |
| **缓存/限流** | 进程内 LRU + Postgres 计数（单 Pod 够用） | `RateLimiter` / `Cache` 接口 | Redis Cluster | 换实现，多 Pod 才需要 |
| **实时推送** | SSE（单 Pod，无需 pub/sub） | `Notifier` 接口 | WebSocket + Redis pub/sub | 换实现 + 加 pub/sub |
| **沙箱 runner** | **Docker no-network + ulimit**（一台小机器即可） | `SandboxRunner` 接口（run(code,tests)→result） | Firecracker/gVisor runner pool | 换 runner 实现，API 不动 |
| **LLM judge** | API 内函数调用，单裁判 | `Verifier` 接口 | 独立 verification service + 多裁判 | 抽成服务，换实现 |
| **风控** | NoopRiskEngine（已设计） | `RiskEngine` 接口（已设计，4 钩子） | 私有 risk-engine 服务 | 设 RISK_ENGINE_URL，零改动 |
| **MCP** | 现有进程内 MCP server | 已是独立 transport 层 | 独立 MCP gateway 服务 | 抽进程，协议不变 |
| **Auth** | hashed API key（单表） | `key_hash` 列 + scope 字段预留 | org/成员/权限/轮换 | 加表关联，增量 |
| **支付** | **关闭**（beta 不开兑换/充值） | ledger 已隔离 gift/earned | Stripe + webhook + outbox | 新增模块，不影响核心 |
| **部署** | 单 region managed 容器（Fly.io/Railway ~$5-20/mo） | 无状态 API + 12-factor 配置 | K8s 多 region | 换编排，应用不动 |
| **可观测** | structured log + 免费档 Sentry | OpenTelemetry 标准 API | OTel + Prometheus/Grafana | 接 collector，埋点不变 |

---

## 2. 三条最关键的"省钱不留债"决策

### 2.1 Temporal 降级为目标态，beta 用 Postgres outbox

**省钱理由：** Temporal Cloud 有起步费；自托管要运维 Cassandra/Postgres + 多角色 worker。
**零真实交易量时引入它，是为不存在的规模付费。**

**接缝：** 定义 `WorkflowRunner` 接口。beta 用一张 `workflow_state` 表 + 幂等键 +
cron reconciler 推进状态机（覆盖 deadline 回收、webhook 入账、复核挂起 ~90% durable 语义）。

**迁移保证：** 商业化时实现 `TemporalWorkflowRunner`，工厂按 env 切换——业务代码零改动。
判据：交易量上升到 reconciler 延迟/复杂度成为瓶颈时才迁。

### 2.2 credits 锁死不可兑现 → 推迟一大批 P0 加固

**省钱理由：** §3 money pump 的前提是"积分能兑换真实价值"。**beta 期 credits 不可兑现，
套利风险根本不存在**，于是这些可以推后：

- 积分双账户隔离（gift/earned）：接缝先留（ledger 加 `credit_class` 列），逻辑后置
- 严格风控接缝接入结算：beta 用 Noop
- 提现/KYC/支付：完全不做

**但仍需现在做的最小集**（成本低、且是接缝）：ledger 加 `credit_class` 列、`compute_source`
字段、API key hash——都是**加列级**改动，现在做几乎零成本，日后补做要数据迁移。

### 2.3 沙箱：按"谁提交代码"分级，而非一刀切上 Firecracker

**省钱理由：** Firecracker/gVisor runner pool 要专门的机器和运维。
**beta 若只跑平台自造种子任务（auto_rules 验证），RCE 面尚未打开。**

**接缝：** `SandboxRunner` 接口。beta：
- 阶段 A（自造种子任务，auto_rules）：**不需要 runner**，零成本
- 阶段 B（开放陌生 auto_tests）：Docker `--network=none` + ulimit + 清空 env（一台小机器）

**迁移保证：** 商业化换 `FirecrackerRunner` 实现接口，验证逻辑不动。

---

## 3. beta 阶段成本估算（月）

| 项 | 选择 | 月成本 |
|----|------|--------|
| DB | Neon/Supabase 免费档或入门档 | $0–20 |
| 部署 | Fly.io / Railway 单 region 小实例 | $5–20 |
| 沙箱 | 阶段 A 无；阶段 B 复用同机或一台小 VM | $0–10 |
| 对象存储 | R2 免费档（beta 结果小） | $0 |
| Sentry/日志 | 免费档 | $0 |
| 支付/Temporal/Redis | **beta 不启用** | $0 |
| **合计** | | **~$5–50/mo** |

对照商业化目标栈（Postgres HA + Temporal + Redis Cluster + runner pool + 多 region）
轻易上 $数百–千/mo。**接缝设计让你在验证成功前不碰这条成本曲线。**

---

## 4. 现在就必须做对的"接缝清单"（否则日后是重写债）

这些不增加 beta 成本，但缺了日后要重构。**全是"加列/加接口"级别，现在做几乎免费：**

- [ ] DB 用 Postgres（不是 SQLite）——哪怕单实例。SQLite→PG 是方言重写，PG→PG HA 是扩容
- [ ] DB 访问走仓储层（Kysely），route 里不出现裸 SQL
- [ ] 账本：余额从 ledger projection 得出；加 `credit_class`（gift/earned）列
- [ ] account 加 `compute_source` 列
- [ ] API key 存 hash
- [ ] 定义 5 个接口：`WorkflowRunner` / `Queue` / `SandboxRunner` / `Verifier` / `RiskEngine`
- [ ] 资金副作用全部幂等键化（outbox 与 Temporal 通用前提）
- [ ] 配置 12-factor（env 注入，无硬编码）

> **判据：** 凡是"换实现不换调用方"的，beta 用最便宜的；凡是"换了要改数据结构/调用方"的，
> 现在就按目标态定好接口和 schema。前者省钱，后者防债。

---

## 5. 与现有路线图的差异（建议调整）

| 路线图现状 | 本评估建议 | 理由 |
|-----------|-----------|------|
| Temporal 列为 Phase 2.2 核心 | 降为目标态，beta 用 Postgres outbox（保留 `WorkflowRunner` 接缝） | 零交易量不付 workflow 引擎运维税 |
| 列了 5 个独立服务 | beta 仅 sandbox runner + risk-engine 独立；其余为单体内强边界模块 | 守住"模块化单体优先"原则，降一致性成本 |
| P0 加固在"验证需求"之前 | credits 锁死不可兑现 → 沙箱/双账户/风控推到"开兑换出口前" | 先用最小成本验证付费意愿 |
| SQLite 保留为本地 fallback | beta 即用 Postgres（可用免费档） | 避免 SQLite→PG 的并发竞态(§1.2)和方言重写 |

**净效果：** beta 月成本压到 ~$5–50，同时通过 8 条接缝清单保证商业化迁移是"换适配器"
而非"重写"。先证明有人付费，再爬成本曲线。
