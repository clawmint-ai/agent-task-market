# 修复 PR(CI 失败 / 评审意见 / 同步 main)

处理一个已开 PR 在评审阶段的弹回:拉取 CI 失败日志与 review 意见 → 诊断 → 修 → 同步 main → 重跑对照验收标准的验证。补齐"实现一次不一定过"的真实循环。

## 输入

PR 编号 / 分支名 / 留空: $ARGUMENTS

- 给了 PR 号(如 `42`)→ 用它
- 给了分支名 → 找其对应 PR
- 留空 → 用当前分支对应的 PR;找不到就停下来问,不要瞎猜

## 执行流程

1. **定位 PR + 拉取状态**(只读)
   - `gh pr view <pr> --json number,headRefName,baseRefName,mergeable,mergeStateStatus`
   - `gh pr checks <pr>` —— 哪些 check 红了
   - `gh pr view <pr> --comments` 与 `gh api repos/{owner}/{repo}/pulls/<pr>/reviews` —— review 意见
   - 确认本地在该 PR 的分支上:`git switch <headRefName>`
   - **本环境若无 gh / 无网**(代理挡 github)→ 停下来,把需要用户在联网终端跑的取数命令列出来,让用户把 `gh pr checks` 和 review 原文贴回来,再据此继续

2. **归类要处理的项**
   - **CI 失败**:逐个红 check 取日志 `gh run view <run-id> --log-failed`(或从 checks 输出拿到失败 job 名 → 本地复跑同一命令:typecheck → `npx tsc --noEmit`;unit → `npm run test:unit`;integration → 需 DB;docker → `docker compose build`)
   - **Review 意见**:逐条列出 reviewer 要求,标注「同意改 / 需澄清 / 不认同」——不认同的别默默忽略,回到用户确认
   - **冲突 / 落后 main**(`mergeable=CONFLICTING` 或 strict 要求最新)→ 需要 sync(第 4 步)

3. **本地复现失败再修**(关键)
   - 别凭 CI 日志猜——本地跑出同一个红,才动手修
   - typecheck 红 → `npx tsc --noEmit` 看真实报错;test 红 → 跑对应 `test:unit`/`test:integration` 复现
   - 修完**重跑该命令确认变绿**,再继续下一个红项
   - 触资金/风控路径的修复,重跑相关单测/集成测试,不只 typecheck

4. **同步 main(落后或冲突时)**
   - `git fetch origin`
   - rebase 优先(保持线性历史):`git rebase origin/main`
   - 有冲突 → 逐文件解,解完 `git add <file> && git rebase --continue`;冲突复杂或涉及资金逻辑 → 停下来让用户确认解法,别赌
   - rebase 后**必须重跑验证**(rebase 可能引入语义冲突 tsc 抓不到)
   - 推送用 `--force-with-lease`(不是 `-f`)——只在远端没被他人动过时覆盖

5. **对照验收标准重验**
   - 改动可能动了之前 ✅ 的项——把本 PR 关联 issue 的「完成标准」重新过一遍(同 `/create-pr` 的矩阵口径)
   - 本会话能验的现在跑,标 ✅ 留证据;需联网/docker 的标 🔬

6. **交棒**
   - 修复改动用 `/create-commit` 提交(`fix:` 前缀;回应 review 的提交正文写清"address review: <要点>")
   - 推送后在 PR 上 `gh pr comment <pr>` 回应每条 review 意见(改了什么/为什么这么改),或提示用户回应
   - 若 review 是 Request changes,改完请 reviewer re-review

## 约束

- **先复现再修**:本地跑出同一个失败才动手,不照 CI 日志盲改
- **修完必重验**:每个修复重跑对应命令确认变绿;rebase 后整体重验
- **force 用 lease**:同步只用 `--force-with-lease`,绝不 `git push -f`
- **不吞评审意见**:不认同的回到用户确认,不默默忽略也不默默照做
- **不夸大**:重验矩阵里 ✅ 只给本会话真跑过的
- **冲突涉资金逻辑必停**:settlement/escrow/ledger 的合并冲突,停下来人工确认解法
- **语言**:代码/提交英文,交流与 PR 回应中文

## 与其他命令的关系

```
/create-pr   → 开 PR
/fix-pr      → CI 红 / review 意见 / 落后 main → 诊断修复重验   ← 本命令
/create-commit → 修复改动提交(fix:)
```
循环直到 CI 全绿 + review 通过 + 与 main 最新,然后合并。
