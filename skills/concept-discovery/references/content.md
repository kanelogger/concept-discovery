# 当前卡片内容

日常新卡是普通Markdown文档：原生标题、自己的理解、出处。出处可暂缺，不能编造。用法、何时别用、例子、自测、别名、标签和相关链接都可选；只生成有内容的部分。

create 输入：

```json
{"op_id":"new-card-unique-id","card":{"title":"瓶颈","understanding":"限制整体通过能力的环节或资源。","sources":"作者、链接与必要备注","question":"什么证据能帮助判断瓶颈？"}}
```

可选字段：language（默认cn）、usage、boundary、example、question、aliases（文本列表）、tags（文本列表）、related（Markdown链接）、body（Markdown）、readings（明确要求分离的补充材料列表，每项title/markdown，可选language）。不自动创建其他语言副本。短body直接显示，超过6000字符才自动作为阅读页；readings仅在明确提供时创建。

get 的 schema=2 返回当前title、markdown、summary、sources、readings、sections及文档hash；markdown是唯一内容事实源，sources是“出处”标题下的提取片段，不能把未提取到当成确认没有来源。sections给出当前可写块ID/原Markdown/指纹。原生新建的普通笔记放在知识卡目录内也能查询，不要求填写维护属性。

已有旧schema=1仍返回locales与sections，旧分类/英文/关系不删除；concept.locales创建输入只作旧客户端和保真迁移兼容，不用于日常新卡。旧版本、回执、备份属于维护信息，不写进学习正文。
