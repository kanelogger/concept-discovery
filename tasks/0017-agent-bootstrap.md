# Agent 环境与按需上下文接入

Status: ready-for-human

## 目标与范围

用户显式调用 `kane-agent-bootstrap` 启动。基线为当前 `codex/simplify-personal-wiki`，起始工作树干净。保留既有单人LLM Wiki产品、Markdown任务流程及按风险验证约定，补齐真实环境声明、薄索引及读取/增量维护协议；只作独立本地提交。

采用技能包的 AGENTS、环境清单、忽略规则和工作流适配原则，复用仓库已有规则和正文。创建 `project.yml` 与 `.agents/context/index.json`；合并 `AGENTS.md`、`workflow/README.md`、`AI_ENVIRONMENT.md`、`.gitignore`；修正与初始化实现冲突的安全文档。任务和状态仍是唯一进度入口。

## 来源事实与决策

| 事项 | 当前结论 | 来源 | 状态与影响 |
| --- | --- | --- | --- |
| 产品与主链 | 资料快照→只读单卡草稿→普通编辑保存/读回；生成不写卡 | specs/product-contract.md；lib/wiki.mjs；lib/wiki-draft.mjs；lib/documents.mjs；web/workspace.mjs | 已核对实现，作为索引业务入口 |
| 环境 | Node24、固定思源3.8.9、Compose只公开回环应用端口 | package.json；deploy/Dockerfile；deploy/compose.yaml；scripts/deploy-init.mjs | 已确认声明及源码；本轮实际运行另列，不复用历史passed |
| 私有状态 | workspace、operations、wiki及配置共同保留；测试需独立私有根 | AI_ENVIRONMENT.md；lib/wiki-store.mjs；scripts/deploy-init.mjs；tests/service/runtime.mjs | 已确认；不启动正式服务或迁移秘密 |
| 密钥与本地认证 | 用户明确“暂时没有密钥要求”；初始化自动生成本地认证，未来模型配置不作当前前置条件 | 用户本轮修正；scripts/deploy-init.mjs；server/model-settings.mjs | 已确认阶段约束；保留既有私有配置，不读取或迁移秘密 |
| 索引归属 | 业务正文/命令不搬家；来源变化须重新核实，任务仍由workflow-state指向 | AGENTS.md；workflow/README.md；技能retrieval协议 | 本次采用；无客户端hooks或自动技能调用 |
| 支持范围 | 本机macOS；跨平台及真实远程模型质量未复验 | 本轮宿主；原项目验证边界 | 未知保留null；只限制相应运行结论 |

选择薄索引与已有规则合并，是为了让后续Agent定位原始事实，避免再维护一套正文；若来源入口或命令改变，需要重读来源并修正对应条目。项目没有方向性未知阻塞接入，无需初始化访谈。用户进一步明确暂时没有密钥要求，已按此修正安全规则与环境清单，不能从初始化自动生成token推导为用户当前必须准备密钥。

只读inspect退出1/status=unverified：扫描包含旧.local工件并达到8MiB总读取预算，不能作完整性证明；只使用所需受管文件的摘要与真实根配置，不采用旧worktree的命令。该工具读取过部分旧本地工件以计算摘要，本轮不声称所有私有路径均未读取；未展示秘密值或私有正文，未写正式数据。后续检查限定本次公开来源，完整inspect输出收尾删除，仅保留脱敏覆盖说明。

## 验证

本次仅修改协作材料与环境声明，无应用行为变更，不增加镜像测试。以下均为本轮实际运行，旧任务的passed不作为本轮证据。

| 场景 | 实际结果与覆盖范围 |
| --- | --- |
| 技能工具环境 | 锁定依赖只在技能目录安装，yaml@2.9.1；首次沙箱EPERM，自动审批目录写权限后成功，项目依赖未修改 |
| 本机基础 | `npm run doctor` passed：Node24.22.1、Git2.56.0、仓库根；Compose5.5.0；本轮资源核对读到Docker29.8.2 |
| 文件投放及结构 | dry-run与apply通过并先保存收据；限定本次7份协作文件（包含索引）的verify通过、25条Markdown链接可达，索引12/12通过。仅warning为supported_platforms=null，跨平台未知如实保留；未运行会扫描旧私有工件的默认全仓技能verify |
| 公共检查 | 全新上下文审阅者从入口定位后执行`npm run check`：首次89/93，4项因沙箱listen EPERM失败；获自动审批回环权限后重跑93/93、无跳过，42份Markdown校验通过。最终仅文档字段调整，不重复执行Node测试；完成前重跑validate及差异检查 |
| 真实key与节点 | `commands`、`business.draft`等命中正确来源；start/plan/implement/verify读取通过，无遗漏；handoff已完整返回12条正文及本任务，无stale/changed/预算遗漏；因4份未索引入口/状态文件提示uncovered而退出1/unverified，已按下行人工核对。最终verify中的全索引检查12/12passed。共执行6次node读取（start两次，其余节点各一次），保留5份节点结果；实际读取字节、返回字节、文件数见本机evidence，不以字节推算token或性能承诺 |
| 变化探测与更新 | 项目环境及安全来源变化准确提示4条changed；读回并核实后context update仅增量维护受影响项。独立临时副本修改package.json后，commands=changed、environment.check=stale且不返回过期综合正文；探测前passed，探测后预期unverified，副本已回收 |
| 未索引改动 | 初次apply提示AGENTS、.gitignore、AI_ENVIRONMENT、任务与状态共5份无依赖条目；人工逐项核对入口/忽略/状态归属，不要求每个文件都建路由。最终handoff通过显式--task覆盖任务变化，剩余4份AGENTS/.gitignore/AI_ENVIRONMENT/workflow-state的uncovered均为预期：分别核对导航/忽略规则/环境链接/当前任务状态；变化过滤的uncovered提示不等于12个现有条目过期 |
| 全新上下文独立审阅 | fork_turns=none，仅从根AGENTS导航到环境、工作流、状态/任务、索引，再定位命令、规则、业务源码和回归。实际公共check通过，忽略规则实测正确，12条摘要复核匹配；建议已落实为纯definition_source路径、精确init脚本名及独立字段 |
| 真实内核业务链路 | `npm run test:integration` passed/0，run=cd-service-e799903359；构建通过，合成来源→只读单卡草稿→普通保存→独立读回，另覆盖鉴权、版本冲突、历史读取、回执、恢复和重启。模型使用回环合成服务，未调用远程模型 |
| 清理独立核对 | run.json为result=passed、cleaned=true、cleanup=passed；主Agent按该run的Compose标签回读容器/卷/网络为空，专属应用镜像不存在，临时私有根不存在。探测副本已清理；正式库未写入 |

## 失败与未覆盖

- inspect被旧.local工件及构建产物占用读取预算，退出1/unverified；保留限制说明，不据此判断项目没有命令或资料。完整扫描输出收尾删除，不写入提交。
- 初轮技能verify的definition_source含解释文本，被作为路径拒绝；已改为纯package.json路径，script与implementation_sources另列，重验通过。用户“暂时没有密钥要求”的阶段约束优先，已明确写入清单及安全规则。
- 默认沙箱拒绝技能目录写入、回环监听和Docker socket，分别在必要的有限自动审批后完成；没有修改系统或npm安全配置。
- 本轮不复验浏览器/移动端/公网部署、冷备恢复、跨平台支持或真实模型生成质量。文档范围无需新增浏览器检查或冷备恢复；集成回环模型不证明真实模型效果。没有客户端hooks，不能宣称CLI强制调度或其他客户端已经加载新规则。

## 交接

协作材料、环境声明、12条薄索引与五节点读取/维护协议已接入并验证；当前阶段没有密钥要求。工作流继续以本任务为唯一事实记录。用户以后可直接给新任务；普通任务按项目协议读取原始来源，无需重复初始化或安装技能工具。

主收据：`.agents/state/bootstrap/0017-adoption.json`；后续阶段修正、命令修正及两次索引增量更新各有同目录0017收据。收据为本机恢复依据，不提交；源码或任务后续已修改时不得用旧收据覆盖。脱敏结构、节点、变化探测及清理证据在`.agents/state/bootstrap/0017-evidence/`，集成必要合成证据在`.local/service-acceptance/cd-service-e799903359/run.json`。

仅保留最终协作材料及少量脱敏证据，删除本轮/private/tmp内的一次性计划、生成器、完整inspect扫描和探测脚本；保留已准备的技能锁定依赖和集成构建，不清理共享缓存。未启动正式服务、未迁移知识、未推送或部署。本任务相关文件形成独立本地提交，具体哈希由交付回复与Git历史查询。

无阻塞。后续改命令、服务或业务入口时，先修事实所属来源，再核对本次影响的索引条目；跨平台或真实模型能力在用户实际需要时另行验证。
