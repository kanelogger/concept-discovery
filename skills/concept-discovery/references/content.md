# 知识卡内容

新卡从 `raw/<学科>/<稳定英文标识>/article.md` 维护，YAML 的 `name` 填中文标题。正文写自己的理解和可核对的出处，例子、适用情境、边界、自测问题、别名、标签和相关链接按实际内容填写。卡间引用放在说明关系的原句中。已存在的卡沿用原标识以保留链接。[知识卡模板](../../../templates/wiki/article.md) · [原稿与相对链接示例](../../../raw/README.md)

读取普通卡时，`get` 的 `schema=2` 结果包含 `title`、`markdown`、`summary`、`sources`、`readings`、`sections` 及文档哈希。`markdown` 给出当前内容，`sources` 是从出处小节提取的片段。字段为空时仍应核对正文及材料链接。

旧 `schema=1` 中文卡保留固定字段、原生块 ID、人的理解及补充阅读。`get-document` 读取这两类卡的当前正文、修订和网址；公开接口的 `editable` 和 `deletable` 均为 `false`。章节 ID 可用来定位正文。
