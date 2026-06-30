<!-- 由 /create-pr 生成,对照 CLAWMIN-34 / CLAWMIN-5 验收标准。覆盖 3 个提交。 -->

## What & why

为公开发布做 observability + 一键 demo + 部署硬化,落地 `main` 分支保护的合并门禁脚手架,并把团队共享的 slash 命令纳入版本控制。

Closes CLAWMIN-34
Refs CLAWMIN-5, CLAWMIN-17

## 改动概览

三个提交,一条交付线(开发流程 + 部署就绪):

- **`6091f61` observability / demo / 硬化** — 结构化 JSON logger、纯函数 metrics domain(`renderPrometheus` + `MetricsSnapshot`)与触库 collector 分离、`/metrics` 暴露账本守恒 + task/exec/account 仪表;compose 增加健康门禁的 seed 服务;`flywheel-proof.mjs` 接入 `npm run proof`;pg sslmode、优雅停机等部署预备。
- **`b4c3af5` 分支保护脚手架** — PR 模板、CODEOWNERS、`docs/branch-protection.md`(SOLO/TEAM 两套预设的精确 `gh api` 命令)。
- **`a3c0d4f` 共享 slash 命令** — 把 `.claude/commands/` 纳入版本控制(gitignore 白名单),团队共享 create-issue / create-commit / create-pr 三个命令;`.claude/` 其余本地状态仍忽略。

## 验收标准对照 — CLAWMIN-34

> 源自 [CLAWMIN-34](https://linear.app/clawmint/issue/CLAWMIN-34) 的「完成标准」,逐条核对。

| # | 完成标准(原文) | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 直接 `git push origin main` 被拒 | 🔬 未验证 | 保护规则须在联网终端 `gh api` apply 后才生效;本 PR 仅提供 runbook,见 [docs/branch-protection.md](docs/branch-protection.md) |
| 2 | 三项 check 未绿的 PR 无法合并 | 🔬 未验证 | 规则未 apply。设计层面已核对:三个必需 check 名逐字匹配 `ci.yml` job name(`.github/workflows/ci.yml:10,48,67`) |
| 3 | `main` 无法被强推或删除 | 🔬 未验证 | runbook 含 `allow_force_pushes/deletions: false`,待 apply |
| 4 | SOLO 预设下 maintainer 能自合绿色 PR | 🔬 未验证 | SOLO 预设 `required_pull_request_reviews: null`,规避自审锁死;待 apply 后由本 PR 自合验证 |

**小结**: 4 条全部 🔬——本 PR 交付门禁的**设计与脚手架**,4 条运行时验收都需在 GitHub apply 规则后于联网终端验证。apply 步骤已写进 issue 执行清单。

## 验收标准对照 — CLAWMIN-5

> 源自 [CLAWMIN-5](https://linear.app/clawmint/issue/CLAWMIN-5) 的「完成标准」。本 PR 不 Close 它,仅推进(补齐了它依赖的 seed/compose)。

| # | 完成标准(原文) | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 一键启动从干净 clone 可复现 | 🟡 部分 | 真机已验证 postgres/backend/mcp 三常驻 `Up` + backend `/health` ok;但服务器当时跑旧代码无 seed。本 PR 把带 seed 的 compose 补上(`docker-compose.yml`),合并后需用新代码重验 `seed exit 0` + `/metrics` |
| 2 | 录屏附在 issue 里 | ⬜ 未覆盖 | 需联网真机录制,留作 CLAWMIN-5 收尾 |

**小结**: 🟡 1 / ⬜ 1。本 PR 解除 CLAWMIN-5 的代码阻塞(seed 缺失),真机重验 + 录屏仍归 CLAWMIN-5。

## 工具改动(`a3c0d4f`,无对应 issue)

slash 命令脚手架,不影响运行时 / 不触及资金或数据路径,无验收标准可对照。属开发流程改进:

- gitignore 白名单已验证:三命令文件可跟踪、`settings.local.json` 仍忽略、`skills/` 未受影响
- 命令自身约束(诚实标注验证状态、精确暂存、不擅自 push)在 `.claude/commands/*.md` 内文档化

## How it was verified

本会话**真实执行过**的:

- ✅ `npx tsc --noEmit` 在 backend + mcp-server 均 exit=0、无输出(无类型错误)
- ✅ `git diff --stat main..HEAD`:含 `a3c0d4f` 后改动与上述三块一致
- ✅ 分支保护 check 名 ⊆ `ci.yml` job name——逐名断言通过;CODEOWNERS 6 个路径全部真实存在
- ✅ gitignore 白名单:`git check-ignore` 确认 commands/ 可跟踪、其余 .claude/ 仍忽略、skills/ 未受影响
- ✅ `a3c0d4f` 经 `git show --stat` 确认实含 4 文件 +318 行(非空提交)

**尚未在本会话验证**(🔬):

- 🔬 `backend/test/unit/metrics.test.ts`、`remoteRiskEngine.test.ts` 未在本会话运行——CI 的 `backend` job 会跑
- 🔬 `npm run proof`(flywheel)、docker compose 真机起栈——需联网/docker 环境

## Risk & rollout

- 迁移 / schema 变更:无
- 配置 / env 变更:**有** —— 新增 `SANDBOX_ALLOW_LOCAL`(demo 可信种子用)、pg sslmode 相关;`.env.example` 与 `backend/.env.example` 已同步
- 可逆性:全部为新增文件 + 向后兼容改动;回滚 = revert 本 PR,无数据副作用

## Ledger & safety

- [x] 信用移动保持守恒安全:settlement 改动不新增/销毁账本外余额;新增 `/metrics` 的 `atm_conservation_ok` 正是守恒的运行时探针(`backend/src/domain/metrics.ts`)
- [x] 不可信代码路径仍在沙箱护栏下:`SANDBOX_ALLOW_LOCAL` 仅 demo 用;生产启动守卫(`NODE_ENV=production` 无 `SANDBOX_MODE=docker` 即拒启)未改
- [x] 无密钥提交:新增 `.gitignore` 规则挡 pnpm 垃圾文件 + 白名单只放行 commands/;diff 中无凭据
