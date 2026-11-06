# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

维护者本人长期使用，桌面浏览器。

## Product Purpose

持续整理自己的知识，帮助理解和记住知识；遇到任务时找到适用概念与方法，并更准确、简洁地向AI或别人表达。

## Operating Context

个人自托管网站。网页负责阅读、搜索、Markdown整理；Agent在明确要求时查询、应用和维护同一知识源。产品边界以[契约](specs/product-contract.md)为准。

## Capabilities and Constraints

独立列表页（关键词/标签/更新时间筛选与分页）、详情页、新增/编辑页、预览、正文图片、出处和相关链接。网页采用 React 与 Ant Design，Markdown 编辑衔接当前懒加载MDXEditor组件，默认全宽源码编辑，可按需切换可视化和服务端预览。网页使用纸感样式。自测问题是普通正文；没有复习、命令面板、原版导航、厂商账号和同步订阅。不考虑移动端或MCP。

内部思源内核保存唯一知识源，独立网页与CLI共用受保护应用接口。旧卡兼容阅读和Agent局部维护，复杂结构提前标明编辑限制。保留版本指纹、备份、写后核对、操作状态及恢复。

## Product Principles

- 先让记下来、理解、找到、用起来足够轻。
- 资料、来源、边界来自实际知识库，Agent推断另行说明。
- 界面精简同时保留知识与数据保护。
- 每项交付结论有真实执行和读回证据。
