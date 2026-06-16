# 开始实现 Issue(从 Linear 到代码)

喂一个 Linear issue ID 或链接,拉取需求 → 起分支 → 落地实现 → 对照「完成标准」验证 → 交棒给 `/create-commit` 与 `/create-pr`。

## 输入

issue ID / URL / 分支名: $ARGUMENTS

解析规则:
- 完整 ID `CLAWMIN-34` → 直接用
- URL `https://linear.app/clawmint/issue/CLAWMIN-34/...` → 取出 `CLAWMIN-34`
- 裸数字 `34` → 补成 `CLAWMIN-34`
- 留空 → 从当前分支名推断;推断不出就停下来问,**不要**瞎选一个 issue

## 执行流程

1. **拉取需求**
   - `mcp__linear__get_issue`(传完整 ID),取 `目标 / 背景 / 范围 / 完成标准` 四节
   - 记下 issue 的 `gitBranchName` 字段(Linear 给的标准分支名)、`labels`、`milestone`、`identifier`、`url`
   - **若 issue 没有「完成标准」** → 停下来告诉用户,问要不要先用 `/create-issue` 补全;无验收标准不开工(否则做完无法判定 done)

2. **认领**
   - 调 `mcp__linear__save_issue` 把 `assignee` 设为 `me`、`state` 设为 `In Progress`
   - (这样 Linear 上立刻可见"有人在做了",避免重复劳动)

3. **起分支**
   - 先 `git status` 确认工作区干净;不干净 → 停下来问(别把别的改动卷进来)
   - 用 issue 的 `gitBranchName`(若过长可截到 `pengxjwawa/clawmin-XX-<短描述>`)从最新 `main` 起新分支:
     `git fetch origin && git switch -c <branch> origin/main`
     (拿不到 origin/main 就从本地 main:`git switch -c <branch> main`)
   - 已在该分支上则跳过

4. **吃透现状再动手**(关键,先读后写)
   - 把「范围」里点名的每个文件路径都 Read 一遍,确认字段名/函数名/现有实现真实存在
   - 触及资金路径(`domain/`、`services/task/settlement.ts`、`escrow`)或风控接缝(`risk/`)时,额外读相邻实现,理解失败语义(register/publish/claim = fail-open;onFinalize accepted = fail-closed)
   - 涉及数据表时核对真实字段(见 `create-issue.md` 的数据模型表)
   - 改动面大 / 有多种实现取舍 → 先列实现计划让用户确认,再写;改动小且路径明确 → 直接做

5. **实现**
   - 按「范围」逐条落地;匹配周边代码的命名/风格/既有库,不引新依赖除非范围要求
   - domain 层(`backend/src/domain/`)禁触 DB——纯函数;编排放 services 层
   - 改了 domain → 必配单测(`backend/test/unit/`);影响资金流 → 必配集成测试(`backend/test/integration/`);影响 MCP 工具 → 必跑 MCP e2e

6. **对照完成标准逐条验证**
   - 「完成标准」每条都是一条可执行断言——**真去跑**对应命令/操作,记录证据
   - 能在本环境验的(tsc、单测、纯函数逻辑)→ 现在跑,标 ✅ 并留输出
   - 需联网/docker/真机的 → 标 🔬,写明用哪条命令在哪个环境验
   - 有 ❌ 不达标的 → 回到第 5 步修,别带病交棒
   - 验证产生的临时文件用 `$TMPDIR`(沙箱挡 `/tmp`),收尾清理

7. **交棒**
   - 实现 + 验证完成后,提示用户(或按其指示直接)走 `/create-commit` 整理原子提交、`/create-pr` 生成对照本 issue 验收标准的 PR 描述
   - 在 Linear issue 上调 `mcp__linear__save_comment` 留一条进展:已实现哪些、哪些标准 ✅ 已验/哪些 🔬 待联网验、分支名

## 约束

- **先读后写**:动手前必须 Read 范围内的真实文件,不凭记忆/猜测写代码
- **不夸大验证**:✅ 只给本会话真跑过的;没跑的一律 🔬。完成标准是验收合同
- **不擅自提交/推送**:本命令负责"实现到工作区 + 验证",提交交给 `/create-commit`,推送是用户的事
- **不擅自改 issue 范围**:范围内做不到或需偏离(换技术/砍需求)→ 停下来跟用户确认,不要默默改方向
- **认领即可见**:开工前把 issue 设 In Progress + assignee=me,避免并行重复
- **工作区脏不开分支**:起分支前确认 clean,否则先问清楚那些改动怎么处理
- **语言**:代码注释/提交英文,与用户交流和 Linear 留言中文

## 与其他命令的关系

```
/create-issue   → 建规范 issue(定义验收标准)
/start-issue    → 拉取 issue → 起分支 → 实现 → 对照标准验证   ← 本命令
/create-commit  → 把实现整理成原子提交
/create-pr      → 生成对照 issue 验收标准的 PR 描述
```

## 失败语义速查(触及 risk 接缝时)

| hook | 引擎挂了 |
|---|---|
| register / publish / claim | **fail-open** 放行(别让闭源服务不健康拖垮市场) |
| onFinalize (accepted 路径) | **fail-closed** 不结算(结算路径绝不静默放行) |
