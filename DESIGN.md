# DESIGN.md — Concept Discovery 案卷 Atlas

> 像翻阅一份精心编辑的研究案卷，从情境线索走向可核查的概念。

2026-10-04 用户从两种研究图谱原型中选定本方向。本文件约束 0070 的正式 Web 前端改造；产品语义与数据安全仍以产品契约为准。

## 1. Visual Theme & Atmosphere

**Style**：暖纸张的中文编辑设计，结合严谨索引与少量蓝、朱红标记。**Keywords**：考据、清晰、温暖、可读、溯源、层次、留白。**Tone**：安静而有观点。**Feel**：问题被写进案卷，概念像可靠的索引条目浮现。

**Interaction Tier**：L1 精致静态；结果提交、展开和定位使用短时过渡。**Dependencies**：CSS 与原生 DOM，不引入动画库。无滚动劫持、常驻粒子或装饰性 3D。

## 2. Color Palette & Roles

```css
:root {
  --bg: #f2f0e9; --surface: #fffefa; --surface-alt: #e8e7df; --surface-hover: #f6f7f3;
  --border: #d4d4c8; --border-hover: #899985; --border-strong: #a7afa0;
  --text: #19251f; --text-secondary: #45524a; --text-tertiary: #69766c;
  --accent: #244ca0; --accent-hover: #183a82; --accent-soft: #e8edf8;
  --signal: #8c3c2a; --success: #225f49; --warning: #80561e; --error: #a13b3b;
  --bg-rgb: 242 240 233; --surface-rgb: 255 254 250; --text-rgb: 25 37 31;
  --accent-rgb: 36 76 160; --signal-rgb: 140 60 42;
}
```

Color rules：纸色留给大背景，结果卡片使用近白；蓝色只表示主要动作和可进入的知识，朱红只标记关键推论或当前线索。状态使用文字与形状共同表示。组件颜色只引用变量，半透明色用 `rgb(var(--*-rgb) / alpha)`。

## 3. Typography Rules

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@500;600;700&display=swap');
:root { --font-display: 'Noto Serif SC', 'Songti SC', serif; --font-body: 'Noto Sans SC', 'DM Sans', system-ui, sans-serif; --font-mono: ui-monospace, 'SFMono-Regular', monospace; }
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
| --- | --- | --- | --- | --- | --- |
| Hero H1 | display | clamp(38px, 5vw, 72px) | 600 | 1.19 | -0.025em |
| Section H2 | display | clamp(26px, 3vw, 40px) | 600 | 1.3 | -0.015em |
| Card H3 | display | 24px | 600 | 1.4 | 0 |
| Body / long reading | body | 16–18px | 400 | 1.8 | 0.02em |
| Label | body | 12–13px | 600 | 1.5 | 0.08em |
| IDs / references | mono | 12px | 500 | 1.5 | 0 |

正文和知识阅读不得小于 16px。英文回退与中文字体均需可读。**NEVER use**：装饰性手写字、细于 400 的正文、渐变文字、文字投影。按文字装饰规则，案卷方向的各级标题均不加渐变和投影。

## 4. Component Stylings

```css
.a-button { min-height: 48px; padding: 0 22px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: var(--surface); font: 600 15px/1.4 var(--font-body); cursor: pointer; transition: background-color .16s, transform .16s, box-shadow .16s; }
.a-button:hover:not(:disabled) { background: var(--accent-hover); box-shadow: 0 5px 16px rgb(var(--accent-rgb) / .16); }
.a-button:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.a-button:focus-visible { outline: 3px solid var(--signal); outline-offset: 3px; }
.a-button:disabled { opacity: .48; cursor: not-allowed; box-shadow: none; }
.a-button-secondary { background: var(--surface); color: var(--accent); }
.a-button-secondary:hover:not(:disabled) { background: var(--accent-soft); }
.a-card { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); transition: border-color .18s, box-shadow .18s; }
.a-card:hover { border-color: var(--border-hover); box-shadow: 0 7px 24px rgb(var(--text-rgb) / .07); }
.a-card:active { box-shadow: 0 2px 10px rgb(var(--text-rgb) / .04); }
.a-card:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.a-nav { color: var(--text-secondary); text-decoration: none; border-bottom: 2px solid transparent; transition: color .16s, border-color .16s; }
.a-nav:hover { color: var(--accent); border-color: var(--border-hover); }
.a-nav:active, .a-nav[aria-current='page'] { color: var(--accent); border-color: var(--accent); }
.a-nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.a-nav[aria-disabled='true'] { opacity: .48; pointer-events: none; }
.a-link { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.a-link:hover { color: var(--accent-hover); text-decoration-thickness: 2px; }
.a-link:active { color: var(--text); }
.a-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.a-link[aria-disabled='true'] { opacity: .48; pointer-events: none; }
.a-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-secondary); background: var(--surface-alt); font: 600 12px/1.4 var(--font-body); }
.a-badge:hover { border-color: var(--border-hover); }
.a-badge:active { background: var(--accent-soft); }
.a-badge:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.a-badge[aria-disabled='true'] { opacity: .48; }
.a-input { min-height: 56px; width: 100%; border: 1px solid var(--border-strong); border-radius: 8px; padding: 14px 16px; background: var(--surface); color: var(--text); font: 500 16px/1.6 var(--font-body); }
.a-input:hover:not(:disabled) { border-color: var(--border-hover); }
.a-input:active, .a-input:focus-visible { border-color: var(--accent); outline: 3px solid rgb(var(--accent-rgb) / .18); outline-offset: 1px; }
.a-input:disabled { background: var(--surface-alt); color: var(--text-tertiary); }
```

结果条目首层固定展示概念名、相关原因、边界一句和来源入口；展开才显示详细问句、案例、关系。数据状态标签不得暗示自动审核。

## 5. Layout Principles

最大宽度 1440px；内容横向 padding 桌面 48px、平板 28px、手机 20px。长阅读列不超过 760px。发现首页使用 7:5 的输入/案卷预览布局；结果列表采用主列 8/12、侧边线索索引 4/12。章节间距 64–96px，组件间距 16–24px，卡内 24–32px。

```css
.a-discovery-grid { display:grid; grid-template-columns:minmax(0,7fr) minmax(280px,5fr); gap:clamp(28px,4vw,64px); }
.a-results-grid { display:grid; grid-template-columns:minmax(0,8fr) minmax(240px,4fr); gap:32px; }
```

## 6. Depth & Elevation

| Level | Treatment | Use |
| --- | --- | --- |
| Flat | 边框分隔，无阴影 | 主要阅读面、搜索框 |
| Subtle | `0 2px 12px rgb(var(--text-rgb) / .04)` | 概念卡片 |
| Raised | `0 7px 24px rgb(var(--text-rgb) / .07)` | 当前悬停结果 |
| Overlay | `0 24px 64px rgb(var(--text-rgb) / .18)` | 对话框 |

## 7. Animation & Interaction

**Motion Philosophy**：像整理案卷时的轻微定位反馈。**Tier**：L1。**Dependencies**：无。

```css
@keyframes a-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.a-enter { animation:a-enter .26s cubic-bezier(.2,.7,.2,1) both; }
.a-card, .a-button, .a-nav, .a-link { transition-duration:.16s; }
@media (prefers-reduced-motion: reduce) { .a-enter { animation:none; } .a-card, .a-button, .a-nav, .a-link { transition:none; } html { scroll-behavior:auto; } }
```

结果提交后只将视线带到结果标题；不自动切换焦点到无关控制。关系可视化由用户打开，节点选择同步高亮对应结果。无视差、pin、scroll reveal、光标跟随或持续循环背景。

## 8. Do's and Don'ts

**Do**：突出相关理由和适用边界；让来源可直达；保留关键词与 AI 状态区分；让模型失败可恢复；保持中英内容各自独立；让缺图条目同样完整；提供键盘与减少动态效果路径；明确示意数据。

**Don't**：❌ 将模型猜测写成已核实事实；❌ 仅用颜色表示来源或状态；❌ 用大面积占位图推迟概念文字；❌ 让关系线遮挡正文；❌ 自动播放关系动画；❌ 在摘要中省略重要边界；❌ 使用无限滚动藏起页码与定位；❌ 让弹窗承载无法导航的长编辑；❌ 把内容缺失伪装成完整文章。

## 9. Responsive Behavior

| Name | Width | Key Changes |
| --- | --- | --- |
| Desktop | ≥ 1100px | 双列发现与结果侧栏 |
| Tablet | 700–1099px | 输入单列，结果侧栏折入上方摘要 |
| Mobile | < 700px | 单列，首屏先显示情境输入与一个清楚的提交动作 |

所有可触控目标至少 44×44px。关系图在手机以可滑动概念链/列表呈现，不要求缩放二维图。结果理由和边界不得因宽度而隐藏。

```css
@media (max-width:1099px) { .a-discovery-grid, .a-results-grid { grid-template-columns:minmax(0,1fr); } }
@media (max-width:699px) { .a-shell { padding-inline:20px; } .a-card { border-radius:10px; } .a-button, .a-input { min-height:48px; } }
```
