# 创建 Commit(标准化提交)

把当前改动整理成一个或多个**原子提交**,消息遵循本仓库的 conventional-commits 约定,带 co-author trailer。

## 输入

可选范围/意图提示: $ARGUMENTS

- 留空 → 提交当前所有已暂存改动;若无暂存,则审视全部未跟踪+已修改文件,智能分组
- 给了提示(如「只提交 metrics 相关」「拆成两个提交」)→ 按提示约束范围

## 执行流程

1. **看清现状**(只读)
   - `git status --short` —— 全部变更
   - `git diff --stat` 与 `git diff`(已修改)、`git diff --cached`(已暂存)—— 改动内容
   - 无任何改动 → 停下来告诉用户「工作区干净,无可提交」,不要空提交

2. **判断原子性**
   - 一个提交 = 一个逻辑变更。若改动横跨多个不相关主题(如「加了 metrics」+「修了限流 bug」),**拆成多个提交**,各自暂存各自的文件
   - 同一主题的代码+测试+文档应在**同一个**提交里
   - 不确定怎么拆时,列出分组方案让用户确认,不要擅自合并不相关改动

3. **暂存**
   - 用 `git add <具体路径>` 精确暂存,**不要** `git add .` / `git add -A`(避免裹进无关文件)
   - 暂存前扫一眼有无不该进库的文件:`.env`、密钥、`*.log`、`node_modules`、临时文件、调试产物 → 命中则**停下来警示**,让用户确认或先 gitignore

4. **写消息**(见下方格式)

5. **提交**
   - 用 `git commit -F -` + heredoc 传完整消息(避免转义问题),**不要** `-m` 拼多行
   - 保留 hooks(**不加** `--no-verify`),除非用户明确要跳过
   - 优先新建提交,**不** `--amend`(除非用户明确要改最近一次自己的未推送提交)
   - 提交后 `git log --oneline -<N>` 回显结果

## 消息格式

```
<type>(<scope可选>): <主题,祈使句,≤70字符,英文>

<正文:为什么改 + 改了什么的要点。按需分段或用 - 列点。
解释意图与权衡,不要逐字复述 diff。每行≤72字符。>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

### type(必选)

| type | 用于 |
|---|---|
| feat | 新功能 / 新能力 |
| fix | 修 bug |
| chore | 脚手架 / 配置 / 杂务(CI、模板、依赖) |
| docs | 仅文档 |
| refactor | 不改外部行为的重构 |
| test | 仅加/改测试 |
| ops | 部署 / 运维 / 监控 |
| perf | 性能优化 |

### 主题行

- 祈使句、现在时:`add ledger gauge` 不是 `added` / `adds`
- 英文、小写开头、结尾不加句号
- ≤70 字符;说不完的放正文
- ✅ `feat: expose ledger-conservation gauge on /metrics`
- ❌ `feat: 加了一些 metrics 相关的东西并修了点小问题`(太泛、混主题)

### 正文

- 回答**为什么**,而非复述**改了哪行**(diff 自己会说)
- 多要点用 `-` 列;跨子系统时可像 `6091f61` 那样按子系统分段
- 引用真实路径/字段名(`backend/src/domain/metrics.ts`),与 issue/PR 风格一致
- 关联 issue 时正文末加 `Refs CLAWMIN-XX`;若该提交即闭环可在 PR(非提交)里 `Closes`

## 约束

- **绝不** `git add .` / `git add -A` —— 必须精确到路径
- **绝不**裹入密钥/`.env`/大体积产物;命中即停并警示
- **绝不**擅自 `git push`(提交 ≠ 推送;推送是 PR 命令或用户显式要求的事)
- **绝不**擅自 `--amend` 已推送的提交(会改写历史)
- **绝不**加 `--no-verify` 跳过 hooks,除非用户明确要
- 一个提交只装一个逻辑主题;宁可多个小提交,不要一个杂烩提交
- 主题行用英文(与现有 git 历史一致);issue/PR 描述才用中文

## co-author trailer

每个提交正文末尾固定追加(与现有历史一致):

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
