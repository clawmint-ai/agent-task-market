# CLAWMIN-10 — 闭源 risk-engine 私有服务

**目标**：新建私有仓 `clawmint-ai/risk-engine`，实现 open-core 通过 `RemoteRiskEngine` 调用的 4 个 hook，
默认 stub 全放行解锁集成测试，真实启发式放 feature flag 后可灰度。

## 契约（以 open-core 客户端为准，覆盖 issue 过时描述）
- `POST ${base}/onRegister|onClaim|onPublish|onFinalize`，body = 完整 ctx 对象
- 响应必须含 boolean `allow`；可选 `reason / flags[] / reviewSample / creditClass('earned'|'gift')`
- 认证 `Authorization: Bearer <token>`；core 发送 `RISK_ENGINE_KEY`，engine 校验 `RISK_ENGINE_TOKEN`（同一密钥，两侧变量名不同）
- ctx 形态：RegisterCtx{type,name,email?,computeSource?,ip?,fingerprint?}；ClaimCtx{taskId,executorId,publisherId}；
  PublishCtx{publisherId,rewardCredits,type,verificationMode}；FinalizeCtx{taskId,executionId,executorId,publisherId,accepted,score?,verifiedBy}

## 决策（已确认）
- 仓库：本地 `/Users/mac/workspace/risk-engine` 建好 → `gh repo create clawmint-ai/risk-engine --private` 推送
- 深度：完整启发式（自带观测状态，不读 AGPL 库），每项独立 flag，默认关；STUB_MODE 总开关默认开

## 栈
Node + TypeScript + Fastify（对齐核心栈）。beta 用进程内观测存储（接口化，可换 Redis/PG）。零外部 DB 依赖。

## 结构
```
risk-engine/
├── src/
│   ├── index.ts            bootstrap/listen
│   ├── server.ts           Fastify app + 4 路由 + /health + bearer 钩子
│   ├── config.ts           PORT/RISK_ENGINE_TOKEN/STUB_MODE + 每启发式 flag + 阈值(env)
│   ├── auth.ts             bearer 校验(token 未设→放行，便于 loopback)
│   ├── types.ts            RiskDecision + ctx（镜像核心契约）
│   ├── store/observationStore.ts  account(ip,fingerprint,createdAt)、signup窗、pub↔exec 边
│   └── heuristics/
│       ├── sybil.ts        注册 IP/指纹聚类 + 注册突发节流
│       ├── selfDealing.ts  finalize 时回查 pub/exec 同 IP/指纹
│       ├── collusion.ts    往复边/重复配对/紧环
│       └── sampling.ts     抽审采样率
├── test/
│   ├── heuristics.test.ts  各启发式单测
│   ├── server.test.ts      路由+auth+stub 模式+契约形态
│   └── loopback.test.ts    起真实 server，用 RemoteRiskEngine.post 完全相同的请求形态打通
├── Dockerfile              多阶段 slim
├── .env.example  README.md  RUNBOOK.md
├── package.json  tsconfig.json  .gitignore
```

## 裁决姿势（镜像 LocalRiskEngine + 架构文档 §5）
- flag-not-block 为主；唯一硬门 = onPublish 新账户发布上限（只 bound 发布者自己的 escrow，不卡支付）
- onFinalize 永远 `allow:true`（先付后冻 reviewSample），与 fail-closed 调用点配合
- onRegister 永远 allow + `creditClass:'gift'`（隔离赠送积分）

## STUB / flag 语义
- `STUB_MODE=true`（默认）→ 所有 hook 纯透传：register{allow,creditClass:gift}、finalize{allow,reviewSample:false}、其余{allow:true}
- `STUB_MODE=false` → 启发式生效，但每项再受自身 flag 控（RISK_SYBIL_ENABLED 等，默认 off）→ 可逐项灰度

## 验收
- [ ] STUB 模式下 loopback 测试用 RemoteRiskEngine 的请求形态调通 4 个 hook（解锁完成标准①）
- [ ] 每个启发式有独立单测；server 测覆盖 auth(401/放行)、stub、契约字段
- [ ] `npm run build` + `npm test` 全绿，README/RUNBOOK/Dockerfile/.env.example 齐备
- [ ] gh 创建私有仓并推送；不在 agent-task-market 内留任何闭源逻辑
- [ ] 给 agent-task-market 的 docker-compose 增补可选 risk-engine 服务片段（另起 PR，不阻塞本仓）

## 不做（超范围，留后续 issue）
- 持久化存储（Redis/PG）— beta 进程内够用
- 任务内容审核(moderation)、提现风控
- 把 verificationService 的抽审/多裁判编排迁入闭源（架构 §2 提及，独立 issue）
