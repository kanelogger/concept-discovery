# DESIGN.md — B：信号 Signal

> 把模糊问题当作待辨认的信号，用一座安静的研究仪器台展示候选概念与证据。

本文件是 0070 的候选规范，尚未替代仓库根 `DESIGN.md`。原型仅演示静态结果，不调用模型。

## 1. Visual Theme & Atmosphere

**Style**：深色精密研究台，细线、数据刻度与温和的薄荷色定位信号。**Keywords**：精准、夜间、聚焦、可追溯、层次、平静、现代。**Tone**：理性而有探索欲。**Feel**：在杂讯中校准一条可信的知识线索。

**Interaction Tier**：L1 精致静态；局部反馈有短暂位移与淡入。**Dependencies**：CSS 与原生 DOM；无 WebGL、常驻动画或滚动劫持。

## 2. Color Palette & Roles

```css
:root {
  --bg: #101719; --surface: #182226; --surface-alt: #202e31; --surface-hover: #27383b;
  --border: #35474a; --border-hover: #638587; --border-strong: #78999a;
  --text: #f1f5ef; --text-secondary: #b8cbc3; --text-tertiary: #91a9a1;
  --accent: #c9ef85; --accent-hover: #e0ffa4; --accent-soft: #2e4738;
  --signal: #96dce1; --success: #b7e2ac; --warning: #ffcf83; --error: #ffaaa2;
  --bg-rgb: 16 23 25; --surface-rgb: 24 34 38; --text-rgb: 241 245 239;
  --accent-rgb: 201 239 133; --signal-rgb: 150 220 225;
}
```

深色并非黑底霓虹：正文对比和长时间阅读优先。薄荷色只用于主要动作与当前选择，青色用于连线与辅助信息，警告/错误语义独立。所有组件使用变量，透明层以 RGB 通道计算。

## 3. Typography Rules

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
:root { --font-display: 'Noto Sans SC', 'Space Grotesk', system-ui, sans-serif; --font-body: 'Noto Sans SC', 'Space Grotesk', system-ui, sans-serif; --font-mono: 'IBM Plex Mono', ui-monospace, monospace; }
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
| --- | --- | --- | --- | --- | --- |
| Hero H1 | display | clamp(38px, 5vw, 68px) | 600 | 1.23 | -0.025em |
| Section H2 | display | clamp(26px, 3vw, 38px) | 600 | 1.3 | -0.015em |
| Card H3 | display | 23px | 600 | 1.4 | 0 |
| Body / long reading | body | 16–18px | 400 | 1.8 | 0.02em |
| Label | mono | 12–13px | 500 | 1.5 | 0.03em |
| IDs / references | mono | 12px | 400 | 1.6 | 0 |

长篇中文不少于 16px；密集元数据用单色等宽字，但不让正文等宽化。**NEVER use**：发光文字、故障字、极细字重、渐变文字或文字投影。按文字装饰规则，克制风格所有层级均无文字特效。

## 4. Component Stylings

```css
.b-button { min-height:48px; padding:0 22px; border:1px solid var(--accent); border-radius:8px; background:var(--accent); color:var(--bg); font:700 15px/1.4 var(--font-body); cursor:pointer; transition:background-color .16s, transform .16s, box-shadow .16s; }
.b-button:hover:not(:disabled) { background:var(--accent-hover); box-shadow:0 5px 18px rgb(var(--accent-rgb) / .12); }
.b-button:active:not(:disabled) { transform:translateY(1px); box-shadow:none; }
.b-button:focus-visible { outline:3px solid var(--signal); outline-offset:3px; }
.b-button:disabled { opacity:.48; cursor:not-allowed; box-shadow:none; }
.b-button-secondary { color:var(--accent); background:var(--surface); }
.b-button-secondary:hover:not(:disabled) { background:var(--accent-soft); }
.b-card { border:1px solid var(--border); border-radius:12px; background:var(--surface); transition:border-color .18s, background-color .18s; }
.b-card:hover { border-color:var(--border-hover); background:var(--surface-hover); }
.b-card:active { background:var(--surface-alt); }
.b-card:focus-within { outline:2px solid var(--accent); outline-offset:2px; }
.b-nav { color:var(--text-secondary); text-decoration:none; border-bottom:2px solid transparent; transition:color .16s, border-color .16s; }
.b-nav:hover { color:var(--text); border-color:var(--border-hover); }
.b-nav:active, .b-nav[aria-current='page'] { color:var(--accent); border-color:var(--accent); }
.b-nav:focus-visible { outline:2px solid var(--signal); outline-offset:3px; }
.b-nav[aria-disabled='true'] { opacity:.48; pointer-events:none; }
.b-link { color:var(--signal); text-decoration:underline; text-underline-offset:3px; }
.b-link:hover { color:var(--text); text-decoration-thickness:2px; }
.b-link:active { color:var(--accent); }
.b-link:focus-visible { outline:2px solid var(--signal); outline-offset:3px; }
.b-link[aria-disabled='true'] { opacity:.48; pointer-events:none; }
.b-badge { display:inline-flex; align-items:center; min-height:28px; padding:3px 10px; border:1px solid var(--border); border-radius:4px; background:var(--surface-alt); color:var(--text-secondary); font:500 12px/1.4 var(--font-mono); }
.b-badge:hover { border-color:var(--border-hover); }
.b-badge:active { background:var(--accent-soft); }
.b-badge:focus-visible { outline:2px solid var(--signal); outline-offset:2px; }
.b-badge[aria-disabled='true'] { opacity:.48; }
.b-input { width:100%; min-height:56px; border:1px solid var(--border-strong); border-radius:8px; padding:14px 16px; background:var(--surface); color:var(--text); font:500 16px/1.6 var(--font-body); }
.b-input:hover:not(:disabled) { border-color:var(--signal); }
.b-input:active, .b-input:focus-visible { border-color:var(--accent); outline:3px solid rgb(var(--accent-rgb) / .18); outline-offset:1px; }
.b-input:disabled { background:var(--surface-alt); color:var(--text-tertiary); }
```

结果卡首层直接标出情境线索、相关原因、适用边界与来源。可展开的证据层用稳定的纵向结构，不用飞出的覆盖面板打断比较。

## 5. Layout Principles

最大宽度 1480px；桌面水平 padding 48px、平板 28px、手机 20px。长阅读列≤760px。首页采用“左输入 / 右线索台”6:6 双列；结果主列 8/12、关系概览 4/12。章节距 72–96px；组件距 16–24px；结果内部 24–30px。

```css
.b-discovery-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:clamp(28px,4vw,64px); }
.b-results-grid { display:grid; grid-template-columns:minmax(0,8fr) minmax(240px,4fr); gap:32px; }
```

## 6. Depth & Elevation

| Level | Treatment | Use |
| --- | --- | --- |
| Flat | 边框与亮度层级，无阴影 | 结果、输入、侧栏 |
| Subtle | `0 2px 12px rgb(var(--bg-rgb) / .14)` | 当前卡片 |
| Raised | `0 12px 28px rgb(var(--bg-rgb) / .24)` | 弹出菜单 |
| Overlay | `0 28px 72px rgb(var(--bg-rgb) / .55)` | 对话框 |

## 7. Animation & Interaction

**Motion Philosophy**：信号被定位时才亮起，用户思考时保持静止。**Tier**：L1。**Dependencies**：无。

```css
@keyframes b-enter { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:translateY(0); } }
.b-enter { animation:b-enter .24s cubic-bezier(.2,.7,.2,1) both; }
.b-card, .b-button, .b-nav, .b-link { transition-duration:.16s; }
@media (prefers-reduced-motion: reduce) { .b-enter { animation:none; } .b-card, .b-button, .b-nav, .b-link { transition:none; } html { scroll-behavior:auto; } }
```

点击结果可定位右侧关系线索；手机改为紧随结果的文字关系清单。没有不断脉冲的点、背景流光、自动滚动或等待动画。加载状态使用静态骨架与明确文字。

## 8. Do's and Don'ts

**Do**：维护长篇阅读对比度；解释每条候选的情境关联；标明模型与关键词状态；显示边界与出处；用真实名称而非虚构相关度百分比；支持键盘、手机与减少动态效果；让失败后可以重试；明确原型示例属性。

**Don't**：❌ 把深色等同霓虹；❌ 用持续发光吸引注意；❌ 只给分数不给理由；❌ 把关系图当作唯一导航；❌ 隐藏模型失败；❌ 混用中英内容回退；❌ 牺牲正文对比换取气氛；❌ 在滚动时移动输入框；❌ 让未验证内容看似模型确认。

## 9. Responsive Behavior

| Name | Width | Key Changes |
| --- | --- | --- |
| Desktop | ≥ 1100px | 输入与线索台双列，结果旁有关系概览 |
| Tablet | 700–1099px | 输入与结果单列，关系概览折为横向条 |
| Mobile | < 700px | 单列，首屏情境输入和 CTA；结果解释不折叠 |

触控目标≥44×44px。图形关系在手机转为语义化列表；任何重要理由都不能只存在 hover 或线条上。

```css
@media (max-width:1099px) { .b-discovery-grid, .b-results-grid { grid-template-columns:minmax(0,1fr); } }
@media (max-width:699px) { .b-shell { padding-inline:20px; } .b-button, .b-input { min-height:48px; } }
```
