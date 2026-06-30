# 架构拆分设计：AGPL 主仓 + 闭源风控隔离

**Status:** pending approval
**Created:** 2026-06-14
**配套:** [global-task-market-roadmap.md](global-task-market-roadmap.md) §治理决策 · [system-deep-analysis.md](system-deep-analysis.md) §4

---

## 1. 核心原则：接缝隔离（Seam Isolation）

AGPL 的传染性触发条件是"分发/提供网络服务时包含 AGPL 代码"。要让闭源风控不被传染，
唯一干净的做法是**进程边界隔离 + 接口注入**：

```
AGPL 主仓（开源）                          闭源仓（私有）
┌─────────────────────────┐              ┌──────────────────────┐
│ market-core             │              │ risk-engine          │
│  routes / services      │  internal    │  反作弊/风控/复核抽样  │
│  credit ledger          │──HTTP/gRPC──▶│  关系图/Sybil/合谋    │
│  RiskEngine 接口 + 默认  │   (内部API)  │  实现 RiskEngine 协议 │
│  开源 no-op 实现         │◀─────────────│                      │
└─────────────────────────┘   裁决结果    └──────────────────────┘
```

**关键：** AGPL 仓内**只有接口定义和一个开源的默认实现**（permissive/no-op），
不含任何闭源逻辑。闭源 risk-engine 是独立部署的服务，AGPL 仓通过网络调用它——
网络调用不构成"衍生作品"，不触发 AGPL 传染（这是 SaaS 后端调用专有服务的标准合规姿势）。

---

## 1.1 完全商业化服务边界（2026-06-14）

商业化版本不应把所有能力都塞进 Fastify API，也不应一开始拆成过多微服务。推荐采用
**模块化单体 + 必须隔离的高风险服务**：

| 边界 | 形态 | 是否必须独立 | 原因 |
|------|------|--------------|------|
| Market API | TypeScript/Fastify 模块化单体 | 否，先保留单体 | 账户、任务、基础结算入口共享事务和模型，早拆会增加一致性成本 |
| Ledger Module | Market API 内强边界模块，Postgres 双分录账本 | 逻辑独立，物理可同进程 | 资金不变量必须集中治理，所有余额从 ledger projection 得出 |
| MCP Gateway | 独立服务 | 是 | Agent 协议、多租户 session、工具版本、HTTP/stdio 适配不应污染核心市场逻辑 |
| Verification Service | 独立 worker/service | 是 | 自动验证可能慢、贵、失败；必须异步、可重试、可观测 |
| Sandbox Runner | 独立隔离池 | 是 | 用户代码执行必须和 API 服务权限、网络、文件系统隔离 |
| Workflow Engine | Temporal | 是 | deadline、复核、争议、提现、webhook 需要 durable workflow |
| Risk Engine | 独立闭源服务 | 是 | 反作弊策略不能开源，且结算前裁决要可替换、可审计 |
| Payment/Payout Adapter | Market API 模块 + webhook worker | 逻辑独立 | Stripe/Connect 等外部状态必须通过 outbox/idempotency 接入账本 |
| Admin/Ops Console | 独立前端，调用同一 API | 可独立 | 运营、审核、冻结、申诉和对账是商业后台，不应混入 demo UI |

**商业化原则：**

1. 资金状态只由 Ledger Module 改变；其他模块只能发起命令，不能直接改余额。
2. 所有外部副作用（支付 webhook、LLM 裁判、runner 结果、risk-engine 裁决）必须带 idempotency key。
3. 所有涉及 credits 释放、冻结、兑换、提现的流程必须由 Temporal workflow 编排。
4. API 服务可以 fail-open 处理低风险浏览/发布草稿，但 finalize、兑换、提现必须 fail-closed。
5. 商业后台是 P0，不是后期美化；没有冻结、复核、对账、人工介入能力，就不能开放真实价值兑换。

---

## 2. 接缝点（基于现有代码）

现有 `backend/src/services/taskService.ts` 有四个天然的风控注入点：

| 接缝 | 位置 | 开源默认行为 | 闭源 risk-engine 行为 |
|------|------|-------------|---------------------|
| `onRegister` | accountService 注册时 | 接受所有，发可兑现积分 | 凭据分级校验、指纹、Sybil 检测、赠送积分隔离 |
| `onClaim` | taskService.claimTask:142 | 仅查信誉门槛（现状） | 自交易检测、能力门槛、惊群配额 |
| `onPublish` | taskService.createTask:108 | 直接入库 | 任务内容审核、定价合理性、赠送积分用途限制 |
| `onFinalize` | taskService.finalizeExecution:246 | 直接结算（现状） | 抽样复核标记、合谋图分析、Goodhart 检查 |

`verificationService.ts` 的拆分：
- **保持开源**：auto_rules / auto_tests / auto_llm 的基础执行（无秘密，确定性逻辑）
- **移入闭源**：抽样复核策略、多裁判投票编排、反 prompt-injection 规则、作弊评分

---

## 3. RiskEngine 接口（AGPL 仓内）

```typescript
// backend/src/risk/types.ts  (AGPL — 接口定义)
export interface RiskDecision {
  allow: boolean;
  reason?: string;
  flags?: string[];          // e.g. ['self_dealing_suspected']
  reviewSample?: boolean;    // 是否标记抽样复核
  creditClass?: 'earnable' | 'gift';  // 赠送积分隔离
}

export interface RiskEngine {
  onRegister(ctx: RegisterCtx): Promise<RiskDecision>;
  onClaim(ctx: ClaimCtx): Promise<RiskDecision>;
  onPublish(ctx: PublishCtx): Promise<RiskDecision>;
  onFinalize(ctx: FinalizeCtx): Promise<RiskDecision>;
}
```

```typescript
// backend/src/risk/noop.ts  (AGPL — 开源默认实现，使本仓可独立运行)
export class NoopRiskEngine implements RiskEngine {
  async onRegister() { return { allow: true, creditClass: 'earnable' as const }; }
  async onClaim()    { return { allow: true }; }
  async onPublish()  { return { allow: true }; }
  async onFinalize() { return { allow: true, reviewSample: false }; }
}
```

```typescript
// backend/src/risk/remote.ts  (AGPL — 调用闭源服务的 HTTP 客户端，仍是开源)
export class RemoteRiskEngine implements RiskEngine {
  constructor(private baseUrl: string, private apiKey: string) {}
  // 每个钩子 POST 到 risk-engine 内部 API，超时/失败时按 fail-safe 策略降级
}
```

```typescript
// backend/src/risk/index.ts  (AGPL — 工厂，按环境变量选择实现)
export function getRiskEngine(): RiskEngine {
  return process.env.RISK_ENGINE_URL
    ? new RemoteRiskEngine(process.env.RISK_ENGINE_URL, process.env.RISK_ENGINE_KEY!)
    : new NoopRiskEngine();  // 默认开源可独立运行
}
```

**这套设计的合规性：** AGPL 仓 100% 可独立运行（用 NoopRiskEngine），任何人 clone
下来就是一个完整可用的开源任务市场。闭源 risk-engine 是**可选增强**，通过设置
`RISK_ENGINE_URL` 启用——它在另一个进程、另一个私有仓，AGPL 管不到它。

---

## 4. 仓库结构（拆分后）

```
agent-task-market/                 (AGPL-3.0, 公开仓)
├── backend/        市场后端 + 账本 + RiskEngine 接口/noop/remote
├── mcp-server/     MCP 接入层
├── sdk/            客户端 SDK（未来）
└── LICENSE         AGPL-3.0

risk-engine/                       (私有仓, 闭源, 独立部署)
├── src/
│   ├── server.ts           实现 RiskEngine 协议的内部 API
│   ├── sybil/              女巫检测
│   ├── collusion/          关系图合谋分析
│   ├── sampling/           复核抽样策略
│   └── moderation/         任务内容审核
└── (无 LICENSE 或商业许可)
```

---

## 5. fail-safe 策略（关键安全决策）

risk-engine 不可用时，AGPL 后端如何降级？两种模式按操作风险分级：

| 操作 | risk-engine 宕机时 | 理由 |
|------|-------------------|------|
| onClaim / onPublish | **fail-open**（放行） | 可用性优先，事后补检 |
| onFinalize（涉及积分划转兑现） | **fail-closed**（挂起转人工） | 资金安全优先，宁可慢不可错付 |

---

## 6. 落地步骤（增量、不破坏现状）

1. [ ] 在 `backend/src/risk/` 建接口 + NoopRiskEngine + RemoteRiskEngine + 工厂
2. [ ] 在 taskService 的四个接缝点插入 `riskEngine.onX()` 调用（默认 noop，行为不变）
3. [ ] verificationService 拆分：基础执行留开源，抽样/编排策略抽成接口钩子
4. [ ] 给所有 AGPL 源文件加许可头注释
5. [ ] 新建私有 `risk-engine` 仓，实现协议（先放 §4 攻击面里的检测逻辑）
6. [ ] docker-compose 增加可选 risk-engine 服务，文档说明如何启用
7. [ ] README 标注：开源仓独立可用，risk-engine 为闭源增强

**验收标准：**
- [ ] 不设 `RISK_ENGINE_URL` 时，AGPL 仓功能与现状 100% 一致（noop 透明）
- [ ] 设置后，四个接缝点的裁决由闭源服务返回，且 fail-safe 策略生效
- [ ] AGPL 仓内 grep 不到任何反作弊算法实现（只有接口和 noop）
