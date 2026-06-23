# Owner Email + 密码认证 — 设计文档

**日期:** 2026-06-23
**类型:** 后端认证重构(含前端登录改造)
**前置:** 接续登录页 owner-only 重构(PR #80, `feat/login-owner-onboarding`)

## 1. 背景与问题

当前 owner(人类操作者)登录 web 控制台的唯一方式是粘贴一长串 `api_key`。这是旧的「账户==机器 agent」单一身份模型的遗留:

- `accounts` 表只有 `api_key_hash`,**无** `password_hash`(`backend/src/db/types.ts`)。
- `hashApiKey` 用 **sha256**(`backend/src/domain/apiKey.ts`)——适合 api_key 查找,**不能**用于密码(密码需 bcrypt/argon2 慢哈希)。
- 认证只有 `Bearer <api_key>` 一条路径(`backend/src/middleware/auth.ts`),**无 session/cookie/JWT**。
- `resolvePrincipal(apiKey)` 靠同一个 api_key「先试 owner、再试 agent」区分身份。

owner 已被重新定义为「登录控制台的人类」,让人类粘贴机器凭证登录是错误体验。本设计给 owner 加真正的人类认证(email + 密码),并把 owner 与 agent 的认证彻底分成两条凭证路径。

## 2. 已定决策

1. **认证方式**:Email + 密码。
2. **废除 owner api_key** 作为登录凭证。
3. **web-only 发布**:MCP 的 owner 工具(`publish_task`/`verify_result`)是边角用法(本来就被 `requireOwner` 限制,且文档引导用 agent key 连 MCP);seed/ingest 脚本直连 DB 层、不经 HTTP 认证,不受影响。
4. **服务端 session**(可即时吊销),非 JWT。
5. **破坏性迁移**:当前无真实用户(pre-launch、dev/staging),不做双轨兼容,不保留历史数据。
6. **agent key 认证完全不变**:仍走 `agent_keys` + `getAgentKeyByApiKey` + `Bearer api_key`。

无争议技术项(按最佳实践直接定):
- 密码哈希用 **bcrypt**(自带 salt、慢哈希)。
- session token 明文格式 = `ses_` + `crypto.randomBytes(24).toString('hex')`(对齐 agent key 的 `atm_` + 24 字节生成方式,见 `agentKeyService.newKey`)。
- 存储时对**完整明文 token**(含 `ses_` 前缀)做 sha256 → `sessions.token_hash`。中间件先按前缀分流,再用完整 token 的 sha256 查表。明文仅登录/注册响应返回一次。
- agent key 保持 `atm_` 前缀不变,便于中间件按前缀一眼区分两类凭证。

## 3. 数据模型与迁移

破坏性迁移,无双轨兼容。

### migration `004_owner_password.ts`
- `accounts` 增列 `password_hash text`(owner 必填;agent 身份在 `agent_keys` 表,不涉及)。
- `api_key_hash` 列**保留**(seed/历史引用),但**不再作为 owner web 登录凭证**。
- 现有无密码 owner 账号在 pre-launch 阶段作废(无真实用户)。

### migration `005_sessions.ts`
```sql
sessions (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null unique,   -- sha256(明文 token);明文只在登录响应返回一次
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz             -- 即时吊销:置位即失效
)
```
- 即时登出/吊销 = 写 `revoked_at`(或删行)。
- 有效性判定:`revoked_at IS NULL AND expires_at > now()`。
- 默认有效期:30 天(可由 env 配置)。

## 4. 后端:认证中间件与凭证路径分叉

核心改动。owner 与 agent 的凭证物理上不同,认证入口按 token 类型分流。

### 两条路径
```
owner  → session token (ses_…)  → 查 sessions 表  → { kind: 'owner', account }
agent  → api_key      (atm_…)  → 查 agent_keys   → { kind: 'agent', agentKey, ownerAccount }
```

### `backend/src/middleware/auth.ts`
- `resolvePrincipal` 不再「二选一试 api_key」。改为按前缀分流:
  - `ses_` → 查 `sessions`(有效)→ 取 `account_id` 对应 owner account → `{ kind: 'owner', account }`
  - `atm_` → 查 `agent_keys` → `{ kind: 'agent', agentKey, ownerAccount }`
  - 前缀分流省一次无谓查表,凭证类型一眼可辨。
- `Principal` 类型**不变**(owner / agent 两态)。下游 `requireOwner`/`requireAgent`/`req.account` **零改动**——认证入口变了,授权语义与所有业务路由不受影响。这是把改动半径压到最小的关键。
- SSE 路由(`events.ts`,经 query param 认证)复用 `resolvePrincipal`,自动兼容两条路径。

### `getAccountByApiKey` 的处置
- 从认证路径移除(owner 不再用 api_key 认证)。
- 函数保留并标注 `@deprecated`,降低 blast radius;seed/ingest 直连 DB 不经它,不受影响。

### 新增认证服务与路由
新建 `backend/src/services/sessionService.ts`:
- `createSession(accountId): { token }` — 生成明文 token、存哈希、返回明文一次。
- `resolveSession(token): account | null` — 校验有效性。
- `revokeSession(token): void` — 即时吊销。

新建 `backend/src/services/authService.ts`(或并入 accountService):
- `hashPassword` / `verifyPassword`(bcrypt 封装)。

路由(`backend/src/routes/auth.ts` 或并入 `accounts.ts`):
- `POST /accounts/register`:owner 注册需 `name + email + password`。email 唯一;bcrypt 哈希存 `password_hash`;**不返回 api_key**,直接建 session 返回 `{ token, account }`。
- `POST /accounts/login`:`email + password` → bcrypt 校验 → 建 session → 返回 `{ token, account }`。
- `POST /accounts/logout`:吊销当前 session。

### 错误处理边界
- 登录失败统一 401「邮箱或密码错误」——不区分「邮箱不存在」vs「密码错」,防账号枚举。
- session 过期/被吊销 → 401。
- 注册 email 重复 → 409。
- 密码强度:最小长度 8(后端 zod 校验,前端同步提示)。
- 注册仍受现有 per-IP rate limiter 保护(`registerLimiter`)。

## 5. 前端改动

### `web/src/lib/auth.tsx`
- `localStorage` key `atm.apiKey` → `atm.session`(语义正确,避免与旧值混淆)。
- `AuthProvider` 暴露 `{ token, login, logout }`:
  - `login(token)` 存 token。
  - `logout()` 调 `POST /accounts/logout` 吊销服务端 session,再清本地、跳登录页。
- `api.ts` 的 `request` 仍用 `Authorization: Bearer <token>`——发请求方式不变,只是 token 来源/语义变了。

### `web/src/lib/api.ts`
- 全局 401 处理:session 过期/被吊销返回 401 时,清 `atm.session` 并跳 `/signin`。这是 session 模型必须的闭环。

### `web/src/routes/SignIn.tsx`(PR #80 已改为 owner-only,本次第二步)
- **登录栏**:从「粘贴 API key」改为 **email + password** → `POST /accounts/login`。
- **注册栏**:Name + Email + **Password**(+ 确认密码)→ `POST /accounts/register`;注册成功直接建 session 登录,跳 `/agent-keys`。
- **删除**「Account created — save your API key」展示卡(owner 不再有 api_key)。
- 保留「工作原理」三步流程条(PR #80 加,仍准确)。

### 登出入口
- `ConsoleShell` / `Sidebar` 加登出按钮,调 `logout()`。无需新增路由。

## 6. 测试

- **后端单元**:bcrypt hash/verify;session 生成/校验/吊销/过期边界。
- **后端集成**:
  - 注册→返回 token、无 api_key、可用 token 访问 `/accounts/me`。
  - 登录成功/失败(401 不泄露账号存在性)。
  - 登出后 token 立即失效(401)。
  - 过期 session → 401。
  - **凭证分离不变量**:owner session token 不能当 agent key 用;agent key 不能当 owner session 用;agent key 仍可正常 claim/submit(认证未变)。
  - email 重复 → 409。
- **前端**:`npm run build` + 现有 vitest。
- **MCP**:确认 agent key 连接、claim/submit 全程不受影响(认证路径未动)。
- **守恒**:reconcile 仍通过(本改动不触及 credit ledger)。

## 7. 实施排序说明

本设计是 PR #80(owner-only 登录页)的第二步,改同一个 `SignIn.tsx`。建议**等 #80 合并后从 main 起新分支**,避免同文件冲突。具体排序在 writing-plans 阶段定。

## 8. 范围边界(YAGNI)

明确**不做**:
- 密码重置/找回(需发邮件能力,二期;当前无真实用户)。
- OAuth / magic link(已否决)。
- owner 的程序化 API token(已定 web-only 发布)。
- 「记住我」/多设备 session 管理 UI(session 表已支持多行,但管理 UI 非必需)。
- 邮箱验证流程(二期)。
