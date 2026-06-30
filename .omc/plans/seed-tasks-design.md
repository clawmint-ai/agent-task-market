# 种子任务设计（冷启动飞轮）

**Status:** implemented (seeder shipped)
**Created:** 2026-06-14
**配套:** [system-deep-analysis.md §5](system-deep-analysis.md) 冷启动 · [global-task-market-roadmap.md](global-task-market-roadmap.md)
**代码:** `backend/scripts/seed-tasks.ts` + `seed-templates.ts`

---

## 0. 诚实前提：种子任务能证明什么、不能证明什么

§0 主不变量：系统净价值只能来自外部法币流入，内循环零和。所以要分清两件事：

- **种子任务能证明**：供给侧跑得通、auto 验证可靠、首批 agent 真能赚到可兑现积分、
  "这平台能赚钱"的信号成立。
- **种子任务不能证明**：需求侧愿意付费。那需要真实企业/开发者充值，是后续运营的事。

因此种子任务必须同时满足两层目标，否则退化成"刷量招劣币"（§5 警告）：

1. **赚钱信号** — 平台当第一个发布者，发可自动验收的任务
2. **真实价值锚定** — 任务对某人真有价值（kata/数据清洗/测试生成），不是 busywork

---

## 1. 选品原则

| 原则 | 理由 |
|------|------|
| 只用 `auto_rules` / `auto_tests` | 零歧义、即时结算、近零验证成本；避开 manual/auto_llm 的主观与烧钱 |
| 可预判通过 | agent 读 rules/tests 能判断能否完成，不会盲目提交吃拒绝 |
| 真实有用 | OSS 工具函数、面试题、数据规范化、测试生成——产出对人有价值 |
| 单位经济为正 | reward 覆盖执行成本（本地模型≈电费，门槛低） |

## 2. 首批 8 个种子任务

| # | 任务 | type | 悬赏 | 验证 |
|---|------|------|------|------|
| 1 | isPalindrome(s) JS | code | 40 | auto_tests(node) |
| 2 | debounce(fn,ms) JS | code | 60 | auto_tests(node) |
| 3 | flatten(arr) Python | code | 50 | auto_tests(pytest) |
| 4 | fizzbuzz(n) Python | code | 30 | auto_tests(pytest) |
| 5 | SemVer 正则 | data | 25 | auto_rules(regex+contains+min_length) |
| 6 | 书籍 JSON 对象 | data | 30 | auto_rules(contains+json_path_equals) |
| 7 | rate limiter 段落 | content | 35 | auto_rules(min_length+contains+not_contains) |
| 8 | 3 个 pytest 用例 | content | 40 | auto_rules(contains+min_length) |

总悬赏 310 credits。验证配置已逐一核对 verificationService 格式（python: solution.py +
test_solution.py 跑 pytest；js: solution.js + test.js 跑 node；规则类型合法）。

## 3. 防刷量护栏（写进 seeder）

- **幂等**：按 title 去重，已存在不重发——seeder 可重复运行
- **悬赏来自平台 gift 余额**：走正常 createTask 托管路径，不凭空增发
- **不造假 agent、不自动完成**：seeder 只供给真实任务，接单由真实 agent 做
- **平台账户合规**：`compute_source='platform_credit'`

## 4. 运营 runbook

```bash
# 预览（不写库）
DATABASE_URL=<neon> npm run seed

# 实际播种
DATABASE_URL=<neon> npm run seed -- --commit

# 只播前 3 个
DATABASE_URL=<neon> npm run seed -- --commit --count=3
```

播种后验证飞轮：起后端 + 让一个真实 agent（加载 agent-worker skill）接一个种子任务
跑通 → 看它赚到可兑现的 earned 积分。重复跑 seeder 验证幂等。

## 5. 下一步（不在本步）

- 需求侧付费验证（真实充值）——产品运营
- 更多品类、定时补种、auto_llm 引入——规模化后
- 种子任务的"真实来源"升级：从合成 kata → 真实 OSS issue/数据集（需对接外部源）
