# 验证部署(合并后真机上线核验)

把一次发布在目标环境的固定核验动作固化:拉新代码 → 重建栈 → 断言启动序列 + 账本守恒。补齐"合并 ≠ 上线"的最后一段。源自 CLAWMIN-5 真机踩坑(服务器跑旧代码、缺 seed、/metrics 空)。

## 输入

环境提示 / 留空: $ARGUMENTS

- 留空 → 默认核验本地 `docker compose` 栈
- 给了主机/SSH 别名(如 `aliyun-ecs`)→ 生成在该主机上执行的命令(本命令不直接 SSH,产出让用户跑的脚本)
- 给了 `--fresh` → 重建时用 `down -v` 清库,让 seed 从干净库重播(否则保留数据卷)

## 背景:为什么需要这个

合并到 main 不等于线上更新。这次真实教训:服务器从旧 clone 跑,`docker-compose.yml` 还是无 seed 的旧版,`/metrics` 全空。每次发布都要重跑同一套核验,值得固化。

## 执行流程

> 本会话所在环境无 docker / 无网(代理挡 registry 与 github)。所以本命令默认**产出一份可在目标机粘贴执行的核验脚本 + 预期输出**,而非声称自己跑过。仅当确认本地真有 docker 且能连库时,才直接执行。

1. **更新代码到目标版本**
   ```bash
   cd <部署目录>           # 如 ~/agent-task-market
   git fetch origin
   git switch main && git pull          # 或 checkout 指定 tag/分支
   git log --oneline -1                 # 记下实际部署的 commit,后面比对
   ```

2. **重建栈**
   ```bash
   docker compose down            # 默认保留数据卷;--fresh 时用 down -v
   docker compose up --build -d
   ```

3. **断言启动序列**(健康门禁应保证 postgres healthy → backend healthy → seed exit 0 → mcp ready)
   ```bash
   docker compose ps                      # 三常驻服务应 Up
   docker compose ps -a | grep seed       # seed 应为 Exited (0),不是 (1)
   docker compose logs backend | tail -20 # 看 schema 就绪、监听 3000
   ```

4. **核验运行时不变量**
   ```bash
   # 健康
   curl -s http://localhost:3000/health
   # 账本守恒 —— 必须为 1
   curl -s http://localhost:3000/metrics | grep atm_conservation_ok
   # 种子任务已播(--fresh 时应非空)
   curl -s http://localhost:3000/metrics | grep 'atm_tasks'
   # 完整闭环冒烟(需 jq)
   BASE=http://localhost:3000/api/v1 bash smoke-test.sh
   ```

5. **判定 + 回写**
   - 全绿(seed exit 0 + `atm_conservation_ok 1` + smoke `✅ PASS`)→ 部署核验通过
   - 任一红 → 报告具体哪步、贴日志,**不要**含糊说"应该没问题"
   - 在对应 Linear issue(如 CLAWMIN-5)`save_comment` 记一条:部署的 commit、核验结果、`atm_conservation_ok` 值

## 核验清单(逐条判定)

| 项 | 命令 | 通过标准 |
|---|---|---|
| 部署版本正确 | `git log --oneline -1` | 是预期 commit,不是旧的 |
| 常驻服务起来 | `docker compose ps` | postgres/backend/mcp 均 Up |
| seed 成功 | `docker compose ps -a \| grep seed` | `Exited (0)` |
| 后端健康 | `curl /health` | `{"status":"ok",...}` |
| 账本守恒 | `curl /metrics \| grep atm_conservation_ok` | `atm_conservation_ok 1` |
| 闭环可用 | `smoke-test.sh` | `✅ PASS` |

## 约束

- **不假装跑过**:无 docker/网的环境只产出脚本 + 预期;真执行了才报实际输出
- **守恒是硬门**:`atm_conservation_ok` 非 1 = 账本出血,判定失败并告警,不放行
- **--fresh 会清库**:`down -v` 删数据卷,仅在可接受重置时用;生产环境慎用,默认保留卷
- **记录部署 commit**:每次核验记下实际跑的 commit,出问题能对版本
- **sandbox 口径**:demo 用 `SANDBOX_ALLOW_LOCAL=1`;接外部不可信提交前必须切 `SANDBOX_MODE=docker`,核验时确认该口径符合环境定位
- **语言**:交流与 issue 回写中文

## 与其他命令的关系

```
/create-pr → /fix-pr → 合并(联网终端)
                          ↓
/verify-deploy  → 目标机拉新代码 → 重建 → 断言序列 + 守恒   ← 本命令
                          ↓
   回写 Linear issue,关闭部署相关验收项
```
