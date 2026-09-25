# 知识清单分类映射工作表（2026-09-25）

输入文件：`/Users/kanehua/project/concept-discovery/docs/knowledge-list.json`；SHA-256：`619abeaf8811cfeacea504fe63523fae32c42d58df39d48ed5d6d3c85f1b131e`。本表只列当前 Registry 不接受的代码及其在 80 条中的出现次数；空的“目标或决定”表示待用户决定，**不代表清空字段**。原文件不改写，目录尚未导入。

当前 `epistemic_type` 允许 `formal_model`、`empirical_finding`、`heuristic`、`principle`、`framework`、`law`、`bias` 或 `null`；`domains` 允许 `reasoning`、`communication`；`intents` 允许 `simplify`、`reduce-complexity`。可在最后一列填现有目标代码，或明确写“扩展词表保留原值”；如确需舍弃某值，请明确写“清空”，以便导入时记录决策。若同一决定适用于全部领域或意图代码，可直接对整个字段给出统一决定，无需逐行填写。

## Epistemic type（6 种）

| 来源代码 | 出现次数 | 目标或决定 |
| --- | ---: | --- |
| `concept` | 2 |  |
| `effect` | 13 |  |
| `fallacy` | 4 |  |
| `method` | 6 |  |
| `model` | 11 |  |
| `theory` | 3 |  |

## Domains（48 种）

| 来源代码 | 出现次数 | 目标或决定 |
| --- | ---: | --- |
| `api-design` | 1 |  |
| `attention` | 1 |  |
| `behavior` | 1 |  |
| `behavioral-economics` | 1 |  |
| `collaboration` | 1 |  |
| `competition` | 1 |  |
| `computing` | 1 |  |
| `criminology` | 1 |  |
| `culture` | 2 |  |
| `decision-making` | 9 |  |
| `ecology` | 1 |  |
| `economics` | 9 |  |
| `education` | 1 |  |
| `engineering` | 3 |  |
| `ethics` | 3 |  |
| `evaluation` | 2 |  |
| `evolution` | 1 |  |
| `finance` | 2 |  |
| `game-theory` | 1 |  |
| `innovation` | 1 |  |
| `internet` | 2 |  |
| `investing` | 1 |  |
| `judgment` | 7 |  |
| `learning` | 1 |  |
| `logic` | 2 |  |
| `management` | 3 |  |
| `mathematics` | 2 |  |
| `measurement` | 2 |  |
| `media` | 2 |  |
| `medicine` | 1 |  |
| `methodology` | 1 |  |
| `operations-research` | 1 |  |
| `organization` | 5 |  |
| `persuasion` | 1 |  |
| `philosophy` | 3 |  |
| `planning` | 2 |  |
| `probability` | 4 |  |
| `problem-solving` | 1 |  |
| `productivity` | 1 |  |
| `psychology` | 26 |  |
| `research` | 2 |  |
| `risk` | 2 |  |
| `science` | 3 |  |
| `sociology` | 5 |  |
| `software-engineering` | 7 |  |
| `statistics` | 8 |  |
| `systems` | 1 |  |
| `systems-thinking` | 1 |  |

## Intents（24 种）

| 来源代码 | 出现次数 | 目标或决定 |
| --- | ---: | --- |
| `argue` | 4 |  |
| `avoid-error` | 44 |  |
| `collaborate` | 1 |  |
| `communicate` | 4 |  |
| `decide` | 17 |  |
| `decompose` | 2 |  |
| `design` | 13 |  |
| `empathize` | 1 |  |
| `evaluate` | 24 |  |
| `explain` | 12 |  |
| `identify-risk` | 1 |  |
| `improve` | 1 |  |
| `innovate` | 1 |  |
| `manage` | 3 |  |
| `measure` | 1 |  |
| `negotiate` | 2 |  |
| `obtain` | 1 |  |
| `plan` | 5 |  |
| `predict` | 5 |  |
| `reflect` | 6 |  |
| `simulate` | 1 |  |
| `test` | 1 |  |
| `verify` | 4 |  |
| `visualize` | 1 |  |

## 其他待决

- 22 条 Concept 含明确的占位出处；请决定清空后保留草稿、跳过条目，或给出经过核实的替代出处。
- 这份目录清单不含人工标注的 Eval 案例和数值通过线；它们需作为独立输入提供。
