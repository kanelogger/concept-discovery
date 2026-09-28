# 0040 私有内测与匿名数据收集手册

状态：**个人试用版可用；受邀私有内测准备就绪，尚未启动**。固定实现范围仍为 `0023–0029 + 0031–0040`；本手册不改变 [0040 正式质量 Gate](../../tasks/0040-mvp-eval-acceptance.md)或[冻结通过线](../../eval/thresholds.initial.json)。真实任务随自然使用积累；内测流程用于取得经同意的匿名证据。不得公开部署、开放公网端口或把测试调用计入真实 Usage。

## 1. 启动前冻结与隔离

1. 从[第一稿验收交接包](mvp-handoff-2026-09-25.md)选定一个包含本手册与 `pilot:usage` 的已审查提交 SHA，记录在私有内测日志中；在**新的干净工作区**运行该提交，隔离其他后续票据的修改。运行 `npm run doctor`、`npm run check`、`npm run demo:build`。这些检查使用测试数据库，须在创建内测库之前完成。
2. 复制已核对的 `.local/knowledge-import-inputs/` 三份 JSON 到内测工作区的被忽略目录，用 `node scripts/import-knowledge-list.mjs --source .local/knowledge-import-inputs/source.json --prepared .local/knowledge-import-inputs/prepared.json --report .local/knowledge-import-inputs/cleanup-report.json --db .local/private-pilot.sqlite` 创建**全新**库。核对原始 SHA-256、80 条 active、中文可推荐 59、英文 58、双语均可推荐 58，且 Usage 为 0。导入脚本拒绝覆盖已有库。
3. 只在操作者控制的电脑运行 `CONCEPT_DB_PATH=.local/private-pilot.sqlite PORT=4173 npm start`；服务监听 `127.0.0.1`。受邀参与者在受控的本机会话中使用，不通过公网 URL、反向代理或公开托管访问。每次结束关闭服务。内测库只用于真实参与者会话；调试、自动化测试、合成 Eval 使用另一份数据库。
4. 若参与者同意远端推荐，操作者在内测工作区运行 `npm run model:configure`，由密钥持有人在终端输入可用凭据。推荐会把完成当前任务所需的 `task`、`context`、`response` 发送给 DeepSeek；参与者须先看到下方说明，并在输入前删去机密或可识别细节。未同意远端处理的人不运行推荐；无模型分支可单独演示，但不计入真实推荐调用。

内测期间不修改 Catalog 或模型配置；若确需修改，记录变更时间与 Concept 版本，暂停收集，再决定是否开启新的独立观察批次。不要把 `.env`、内测库、任务原文、会话清单或评测报告提交到 Git。

## 2. 参与者告知与选择

每位参与者开始前展示并记录其选择：

> 这是受邀私有内测，服务只在操作者电脑本地运行。请只使用你正在处理的真实任务，并先删去姓名、账号、客户信息、密钥、内部 URL 和其他机密。你主动调用推荐时，必要的任务文字会发送给 DeepSeek；本地系统自动保存随机 run/task ID、语言、推荐的 Concept ID/版本、时间和你主动给出的反馈，不自动保存任务原文或生成的 Prompt。你可以拒绝参加；也可以参加功能体验但拒绝让去标识化任务文本进入后续 Eval。若另行同意 Eval，维护者会先清理任务文本、只留随机来源编号，并在冻结正式案例前允许凭收据码撤回。

操作者用随机 `session_ref` 作收据码，不记录姓名、邮箱或联系方式。只在被忽略的 `.local/private-pilot/` 保存选择与运行清单；若确需联系参与者，联系方式由操作者另行保管，不与任务文本或 Usage 库同存。内测开始前确定谁可访问这些本地文件及清理日期；本手册不代替组织自己的数据处理审批。

每次会话在 `.local/private-pilot/consent.jsonl` 记一行，如 `{"session_ref":"session-opaque","notice_version":"2026-09-26","recorded_at":"实际 UTC 时间","remote_processing_opt_in":true,"usage_collection_opt_in":true,"eval_reuse_opt_in":false}`。这是**格式示例，不是真实同意记录**。只有远端处理与 Usage 收集均同意时才进入下面的真实推荐会话；`eval_reuse_opt_in` 可独立拒绝。操作者核对同一 `session_ref` 在会话清单中的选择一致。

## 3. 每次真实会话

1. 参与者提出**当前真实任务**，决定 `cn` 或 `en`；先去标识化，再明确调用 [Concept Discovery Skill](../../skills/concept-discovery/SKILL.md)。普通任务、操作者演示、测试脚本、重复造数和直接调用推荐 API 均不计入真实 Skill Usage。
2. 保存 Skill 返回的 `run_id`。在 `.local/private-pilot/runs.json` 的 `runs` 中记录 `run_id`、`locale`、随机 `session_ref`、`user_initiated: true`、`actual_task: true`、`eval_reuse_opt_in` 布尔值。一个真实调用记一条；不给清单补造记录。数据库中的 `task_id`、推荐版本和事件已经由 Skill 自动保存，无须抄写任务原文。
3. 按参与者实际行为记录查看、忽略或无帮助。只有参与者选择 Concept、Agent 用生成 Prompt 完成当前任务的成果后，才记录 `applied`；仅生成 Prompt 不算。NONE 是真实的零推荐调用，单列统计，不进入 Apply Rate 的推荐实例分母。未给反馈的项目保持未决，不推断为 ignored 或 applied。
4. 仅当参与者额外同意 Eval 时，另在 `.local/private-pilot/eval-intake.jsonl` 保存一条**人工去标识化**的真实任务：`ref` 使用 `pilot-<run_id>`，并记录 `locale`、经参与者确认的任务改写、`session_ref`、`review_status: "pending"`。不要复制原始对话、Prompt、诊断、联系人或业务标识。每个来源编号只对应一个独立真实任务；同一任务多次重试不能凑成多个 Eval 来源。

`runs.json` 起始格式：

```json
{
  "schema_version": 1,
  "pilot_id": "private-pilot-01",
  "operator_ref": "operator-01",
  "started_at": "REPLACE_WITH_ACTUAL_UTC_START",
  "runs": []
}
```

此空模板**不是使用证据**。首次会话前把 `started_at` 换成实际 UTC 时间；填入真实 run 时逐条使用上文六个字段。用 `chmod 600` 限制清单和 intake 文件权限。操作者每日对照 Dashboard 和清单，处理遗漏或异常；无法解释的 run 不计入 Gate，并在批次记录中说明。

## 4. 每日核对与匿名化

- 在同一内测库运行 `npm run pilot:usage -- --db .local/private-pilot.sqlite --manifest .local/private-pilot/runs.json --output .local/private-pilot/usage-summary.json`。只读汇总要求清单与库中 run ID 完全一致、语言一致，并按 24 小时或所有推荐已获终态反馈的口径计算 Apply Rate；输出不含任务文字、参与者身份或逐条 run ID。未到数值门槛时命令以状态码 2 结束，但仍写出汇总；这不是服务故障。数值检查不能独立证明参与者真实性，操作者需核对会话记录。
- 保留每日汇总、Catalog/模型版本、参与者告知版本与异常记录；逐日看 `cn`/`en` 调用数、NONE、未结束观察窗和未反馈项目。至少 100 次真实主动调用、每种语言至少 30 次，是后续观察目标；不为追数诱导参与者制造虚构任务。
- 去标识化复核时删除专名、账号、内部路径、精确金额与日期等可反推身份的细节，但保留问题类型、触发条件和需要 Concept 的理由。双人复核或由维护者复核“是否仍是原真实任务”“是否足够匿名”；不合格条目不进入 Eval。参与者撤回时凭 `session_ref` 找到相应 intake，冻结前删除；Usage 的保留或删除按启动前确定的内测规则执行。

## 5. 冻结正式 Eval 与 Gate

1. 从**至少 25 个不同、已同意且匿名化的真实任务来源**选案例，另由维护者撰写至少 25 个典型场景；合计至少 50 条，中文与英文各至少 25、Expected NONE 各至少 5。原有 [50 条 synthetic 草案](../../eval/cases.draft.synthetic.json)只供启发，不能直接改名为真实来源。维护者在看模型结果前逐条复核 `expected_ids`、`locale` 与 `source.kind/ref`，并按[评测契约](../../specs/eval-harness.md)冻结数据集和复核声明。
2. 暂停参与者会话与 Catalog 编辑，在本地服务上运行正式 `npm run eval`，然后 `npm run eval:assess`。Eval 走推荐 API，不写 Skill Usage；确认前后 Usage 数不变。数值通过后仍人工检查诊断、Why Now 的语言、任务相关性、出处主张及多 Concept 覆盖。
3. 按[冻结通过线](../../eval/thresholds.initial.json)核对 100 次真实主动调用、双语分布和 Apply Rate：分母只含观察窗已结束的 `(run_id, concept_id)` 推荐实例，分子为其中实际 `applied` 的实例；NONE 不进入该分母，未决量单列。核对 Concept 质量及至少 30 个双语可推荐条目。只有正式 Eval、真实使用、内容复核及人工输出审查都满足时，才提交 0040 的最终质量验收；不以第一稿验收或私有内测启动代替。

结束内测时停止服务，撤销临时密钥，按启动前约定清理 intake、映射文件与数据库备份。交接材料只保留无原文的汇总、经过批准的匿名案例及决策记录；任何对外发布、合并或部署都另行决定。
