# 创建 PR(对照 Linear 验收标准)

为当前分支生成一份 PR 描述,**逐条对照所关联 Linear issue 的「完成标准」**,标注每条的验证证据与状态,然后用仓库 PR 模板组装、给出可执行的 `gh pr create` 命令。

## 输入

issue 编号或留空自动识别: $ARGUMENTS

- 给了编号(如 `CLAWMIN-34`,可多个空格分隔)→ 用这些
- 留空 → 从当前分支名推断(分支名形如 `pengxjwawa/clawmin-34-...` 或 `feat/...`;推断不出就停下来问,不要瞎猜)

## 执行流程

1. **确定关联 issue**
   - 解析 $ARGUMENTS 或分支名得到 issue 编号
   - 对每个编号调用 `mcp__linear__get_issue`(传完整 id 如 `CLAWMIN-34`),取出 `目标 / 背景 / 范围 / 完成标准` 四节,尤其完整保留「完成标准」的每一条
   - 若一个分支对应多个 issue,全部取来,验收标准合并去重

2. **采集本次改动的事实**(只读,不改任何东西)
   - `git log --oneline main..HEAD` —— 提交清单
   - `git diff --stat main..HEAD` —— 改了哪些文件
   - 需要时 `git diff main..HEAD -- <path>` 看具体改动确认某条标准是否被满足
   - **不要**运行构建/测试除非用户要;若验收标准需要测试证据而本会话没跑过,标为「未验证」而非假装通过

3. **逐条对照验收标准 → 生成证据矩阵**

   这是本命令的核心。对 issue「完成标准」里的**每一条**,判定状态并给证据:

   | 状态 | 含义 | 要求 |
   |---|---|---|
   | ✅ 已满足 | 本 PR 的改动覆盖了这条 | 必须指向具体证据:文件 `path:line`、提交 hash、或本会话实际跑过的命令+输出 |
   | 🟡 部分 | 部分覆盖 | 说明覆盖了哪部分、缺哪部分 |
   | ⬜ 未覆盖 | 本 PR 不解决,留作 follow-up | 明说,不要混进"已完成" |
   | 🔬 未验证 | 代码写了但没在本会话验证过 | 写明需要哪条命令/哪个环境才能验证 |

   **诚实优先**:宁可标 🔬/⬜ 也不要把没验证的写成 ✅。验收标准是给 reviewer 和未来的你看的合同,虚报会反噬。

4. **组装 PR 描述**
   - 读 `.github/pull_request_template.md` 作为骨架(若存在)
   - 在模板的「What & why」填:一句话目标 + `Closes CLAWMIN-XX`(每个关联 issue 一行,GitHub/Linear 会自动联动关闭)
   - 插入上一步的**验收标准证据矩阵**(下方格式)
   - 「How it was verified」只写**本会话真实执行过**的验证;没跑的归到 🔬
   - 「Risk & rollout」据 diff 如实填(迁移?配置/env 变更?可逆性)
   - 触及钱/不可信代码路径(`domain/`、`services/task/`、`runtime/sandbox.ts`)时,勾选模板的账本守恒/沙箱/密钥三项,并各给一句证据

5. **产出**(默认不直接建 PR,先给人看)
   - 完整 PR 描述写到 `$TMPDIR/pr-body-<分支名>.md`(便于复用,不污染仓库)
   - 打印描述全文
   - 给出可直接粘贴的命令:
     ```bash
     git push -u origin <当前分支>
     gh pr create --base main --title "<标题>" --body-file <临时文件路径>
     ```
   - 标题约定:`<type>: <一句话交付物>`(type 取 feat/fix/chore/docs/refactor/ops,与提交风格一致),≤70 字符
   - 若用户在 $ARGUMENTS 明确说了「直接建」「--create」→ 才真正调用 `gh pr create`;否则只产出命令让用户自己跑(本环境可能无 gh / 无网)

## 验收标准证据矩阵格式

PR 描述里这样写(对照每个 issue):

```markdown
## 验收标准对照 — CLAWMIN-XX

> 源自 [CLAWMIN-XX](<issue url>) 的「完成标准」,逐条核对。

| # | 完成标准(原文) | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 直接 `git push origin main` 被拒 | 🔬 未验证 | 需 apply 保护规则后在联网终端验证 |
| 2 | 三项 check 未绿的 PR 无法合并 | ✅ 已满足 | check 名已对齐 `ci.yml` job,见 `docs/branch-protection.md:18` |
| 3 | ... | ⬜ 未覆盖 | 本 PR 不含,跟进 issue CLAWMIN-YY |

**小结**: N 条中 ✅ a / 🟡 b / 🔬 c / ⬜ d。⬜/🔬 项即本 PR 合并后仍需跟进的工作。
```

## 约束

- **只读采集**:本命令绝不修改源码、不提交、不强推。只产出描述 + 命令。
- **证据可点击**:引用文件用 `path:line` 形式;引用 issue/PR 用完整 URL 的 markdown 链接,不用裸 `#编号`。
- **不夸大**:`How it was verified` 与证据矩阵里的 ✅,只能写本会话真实发生过的验证。其余一律 🔬/⬜。
- **关联闭环**:每个被解决的 issue 用 `Closes CLAWMIN-XX`;只是相关但不关闭的用 `Refs CLAWMIN-XX`。
- **语言**:PR 描述用中文(与项目 issue 一致);若仓库 PR 模板是英文骨架,保留其英文小标题,正文填中文。
- **找不到 issue**:推断不出关联 issue 时,停下来让用户给编号,不要生成"无验收标准"的空壳 PR。

## 标题 type 速查

| type | 用于 |
|---|---|
| feat | 新功能 / 新能力 |
| fix | 修 bug |
| chore | 脚手架 / 配置 / 杂务(如 CI、模板) |
| docs | 仅文档 |
| refactor | 不改行为的重构 |
| ops | 部署 / 运维 / 监控 |
