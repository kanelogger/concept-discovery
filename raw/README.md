# 本地知识卡 Wiki

从各学科的导读进入知识卡，沿正文引用跳读，在卡片的 `assets/` 里核对原始资料。跨学科卡可从多个导读进入，每张卡只有一份原稿。

## 维护和同步

在项目根目录编辑原稿后，先运行 `npm run raw -- check`。知识库运行时，用 `npm run raw -- sync --dry-run` 查看差异，再用 `npm run raw -- sync` 写入并读回。同步发现数据库中的卡片已被独立编辑时，会报告版本冲突；从目录中移走文件只会报告缺失。显式归档、指定实例、恢复中断及备份见[命令说明](../docs/agent-environment/commands.md#本地知识原稿)。

同名 JSON 文件记录原文快照的来源标识、作者、日期与哈希；`.sync.json` 记录首次导出时文档、附件和快照的绑定。编辑原稿和材料时保留这些记录。每个实例的后续同步状态保存在自己的私有目录。

## 从哪里开始

学科导读共收录 279 张知识卡。跨学科卡可在多份导读中出现。各卡的图片与原文放在相应目录的 `assets/` 中。

| 学科 | 收录 |
| --- | ---: |
| [元认知与思维方法论](<元认知与思维方法论/README.md>) | 39 |
| [心理学](<心理学/README.md>) | 44 |
| [数学与统计学](<数学与统计学/README.md>) | 21 |
| [微观经济学](<微观经济学/README.md>) | 23 |
| [物理学与化学](<物理学与化学/README.md>) | 20 |
| [生物学与进化论](<生物学与进化论/README.md>) | 20 |
| [工程学](<工程学/README.md>) | 22 |
| [复杂系统与决策科学](<复杂系统与决策科学/README.md>) | 16 |
| [管理学与商业](<管理学与商业/README.md>) | 24 |
| [投资学与金融学](<投资学与金融学/README.md>) | 9 |
| [会计学](<会计学/README.md>) | 11 |
| [法学与政治学](<法学与政治学/README.md>) | 13 |
| [历史学与哲学](<历史学与哲学/README.md>) | 13 |
| [投资原则与品格](<投资原则与品格/README.md>) | 5 |

## 新建一张卡

1. 选择主学科和一个尚未使用的英文标识，用小写字母、数字和连字符创建目录。现有「奥卡姆剃刀」的目录是 `元认知与思维方法论/occams-razor/`。复制[知识卡模板](../templates/wiki/article.md)到其中，文件名保留为 `article.md`。新学科同时复制[学科导读模板](../templates/wiki/discipline.md)为该学科的 `README.md`，并在上表加入入口。
2. 在 YAML 中填中文 `name`，在 `## 核心理解` 下写清这张卡要说明的事。其余章节按需启用。文章以一对独占一行的 `---` 包住 YAML，紧接 Markdown 正文；标题取自 `name`。[完整卡示例](../templates/wiki/examples/哲学/occams-razor/article.md) · [最短卡示例](../templates/wiki/examples/心理学/confirmation-bias/article.md)
3. 有图片、原始文本或补充阅读时，在卡片目录下建立 `assets/`。材料路径从当前 `article.md` 所在目录算起。把适合一起读的卡加入学科导读，并用一句话说明阅读顺序。

下图是模板区的简化示例；正式卡片位置以上面的学科导读为准。

```text
raw/
├── README.md
└── 哲学/
    ├── README.md
    ├── occams-razor/
    │   ├── article.md
    │   └── assets/
    │       ├── comparison.png
    │       └── reading-notes.md
    └── falsifiability/
        └── article.md
```

## YAML 怎么填

| 字段 | 用途 |
| --- | --- |
| `name` | 必填，卡片的中文标题。 |
| `id` | 全库唯一的稳定英文标识，沿用上述英文目录命名方式。省略时取目录名。改名或移动前先显式填入原标识，已有 Wiki 引用即可沿用。 |
| `description` | 一句话摘要，供人在目录里判断是否值得展开。 |
| `aliases`、`tags` | 分别列出同一概念的其他名称、便于查找的主题词，如 `aliases: [奥康剃刀]`、`tags: [推理, 假设选择]`。 |
| `also_in` | 其他学科的中文名称列表。主学科由目录给出，每张卡只需保存一份。 |
| `sources` | 本地原文或原始记录的相对路径列表。同一份材料由多张卡共用时，只保存一份，每张卡各自引用它。 |
| `readings` | 按阅读顺序排列的补充材料，每项包含显示标题 `title` 和相对路径 `path`。 |

暂时没有关联卡片的原文，放入 `raw/未归档/<英文资料名>/`。沿用 `article.md` 与 `assets/` 的结构，在 YAML 填写 `kind: source` 和 `name`，在正文交代材料的作者、出处或取得背景。这样可以单独保存材料，日后再从卡片引用。

## 怎样链接

- **学科导读**用普通 Markdown 相对链接串起推荐阅读顺序。从哲学导读打开同级目录的卡，写作 `[奥卡姆剃刀](occams-razor/article.md)`。导读里的收录只表示导航。
- **卡间引用**写在能看出两者关系的原句中。Wiki 写法为 `[[falsifiability|可证伪性]]`，简写 `[[falsifiability]]` 时约定使用目标卡的名称。通用 Markdown 阅读器可能原样显示双括号；想从仓库直接点开时，写 `[可证伪性](../falsifiability/article.md)`。两种写法表示同一类有向引用，反向链接留给入库时生成。
- **图片与原文**用普通 Markdown。图片如 `![两轮检查结果](assets/comparison.png)`。需要证据的句子旁可直接链到具体材料；下面的示例卡和记录可以离线对照阅读。[示例卡](../templates/wiki/examples/哲学/occams-razor/article.md) · [示例观察记录](../templates/wiki/examples/哲学/occams-razor/assets/reading-notes.md)
