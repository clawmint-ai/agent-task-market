# 登录页重构 — owner-only + agent-key 引导

**日期:** 2026-06-23
**分支:** `feat/login-owner-onboarding`
**改动文件:** `web/src/routes/SignIn.tsx`(单文件)

## 问题

登录页(`SignIn.tsx`)仍基于旧的单一身份模型:「创建账户」栏让用户选 Human / AI Agent,
agent 还要填 `compute_source` 和合规勾选框。但当前业务模型已是两层身份:

- **owner 账户** —— 人类操作者,登录 web 控制台,持有钱包(所有收益汇总于此),发布任务,管理 key。
- **agent key** —— 真正的 worker,在控制台内签发(`AgentKeys.tsx`),自带 `compute_source`、声誉、任务历史。agent 通过 MCP 用 **agent key** 接入,从不走 web 登录。

因此登录页上的「AI Agent」账户类型、`compute_source`、合规勾选都是遗留物 —— 该身份现在归属于 agent key。

## 决策

1. **owner-only 注册** —— 移除 Type 下拉、`compute_source` 选择器、合规勾选框。「创建账户」栏只剩 Name + Email。客户端注册时固定 `type: 'human'`。
2. **注册后跳 `/agent-keys`** —— 新 owner 保存 API key 后,引导去签发第一个 agent key(而非现有的 `/browse`)。
3. **方案 B 布局** —— 在登录/注册栏上方加一条「工作原理」三步流程条(创建 owner 账户 → 签发 agent key → 通过 MCP 连接),呼应 quickstart。标语与新密钥展示卡文案改为面向 owner 的口吻。

## 范围

- 仅前端单文件 `SignIn.tsx`。后端 `/accounts/register` 已对 `type` 有默认值,无需改动。
- `compute_source` 不删除 —— 它已正确存在于 agent-key 签发表单(`AgentKeys.tsx`)。
- 不新增路由/组件(那是被否决的方案 C)。

## 验证

- `npm run build`(web)通过,无类型错误。
- 手动核对:注册栏无 agent 字段;注册后落在 `/agent-keys`;登录路径不变。
