# DESIGN.md

> 让知识管理像一张清晰、安静、可信赖的工作台：先看懂，再行动。

## 1. Visual Theme & Atmosphere

**Style**: 温暖专业的产品后台，以现有鼠尾草绿作为品牌强调色。
**Keywords**: 清晰、安静、可读、温和、可信、轻量、结构化。
**Tone**: 务实、专注、友好；界面优先表达内容状态和下一步操作。
**Feel**: 像一张整洁的浅色工作台，Concept 是被认真整理的知识条目。

**Interaction Tier**: L1 精致静态。
**Dependencies**: CSS only；现有 React、Tailwind 和 shadcn/ui 风格组件，无动画库。

设计范围包括 A Dashboard 首页、B Card First 首页、C 管理工作区，以及共享导航、Concept 卡片、详情、编辑弹窗和状态反馈。三种布局沿用同一套令牌、内容与控件状态。

## 2. Color Palette & Roles

```css
:root {
  /* Base colors */
  --color-bg: #f7f8f6;
  --color-surface: #ffffff;
  --color-surface-alt: #f1f4f1;
  --color-surface-hover: #f6f8f6;
  --color-surface-inverse: #202b26;

  /* Borders */
  --color-border: #e3e8e3;
  --color-border-hover: #b7c9bc;
  --color-border-strong: #cbd5ce;

  /* Text */
  --color-text: #202b26;
  --color-text-secondary: #52615a;
  --color-text-tertiary: #78847d;
  --color-text-inverse: #ffffff;

  /* Accent */
  --color-accent: #4f7560;
  --color-accent-hover: #3f624f;
  --color-accent-soft: #eaf1ec;
  --color-accent-strong: #345341;

  /* Semantic */
  --color-success: #39764f;
  --color-success-soft: #eaf3ed;
  --color-warning: #91651f;
  --color-warning-soft: #f8f1e3;
  --color-error: #ad4846;
  --color-error-soft: #faeeee;

  /* RGB channels for alpha blending */
  --rgb-bg: 247 248 246;
  --rgb-surface: 255 255 255;
  --rgb-text: 32 43 38;
  --rgb-text-secondary: 82 97 90;
  --rgb-accent: 79 117 96;
  --rgb-overlay: 21 31 26;
}
```

**Color Rules:**
- 页面、表面、边框、文字、品牌与状态色都通过以上变量消费；组件中不写颜色字面量。
- 鼠尾草绿只用于主要动作、当前导航、进度和轻量强调；警告和错误仅表示对应状态。
- 保持卡片与背景的明度差小而清楚，以边框和间距组织信息，不堆叠彩色面板。
- 所有半透明状态使用 `rgb(var(--rgb-*) / alpha)`，避免复制第二份色值。

## 3. Typography Rules

**Font Stack:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
```

```css
:root {
  --font-sans: "Noto Sans SC", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Page title | Noto Sans SC / Inter | 28–32px | 600 | 1.3 | -0.025em |
| Section H2 | Noto Sans SC / Inter | 18px | 600 | 1.4 | -0.01em |
| Card title | Noto Sans SC / Inter | 15–16px | 600 | 1.5 | 0 |
| Body / Concept description | Noto Sans SC / Inter | 15px | 400 | 1.75 | 0.02em |
| Label | Noto Sans SC / Inter | 12px | 500–600 | 1.5 | 0.01em |
| Metadata / compact control copy | Noto Sans SC / Inter | 12–13px | 400–500 | 1.5 | 0 |
| IDs / data snapshot | System mono | 11–12px | 400 | 1.6 | 0 |

**Typography Rules:**
- 中文字体置于 fallback stack 首位；英文内容可自然使用 Inter 字形。
- 主要正文至少 15px，描述行高 1.7 以上；12px 仅用于标签、时间和辅助状态。
- 标题使用 600 字重建立层级；避免用全大写、过量字距或超大标题制造装饰感。
- **NEVER use**: 纯英文字体栈处理中文、手写装饰字体、细于 400 的正文、发光或故障字体。

**Text Decoration:** 页面标题、卡片标题和正文均不加渐变或文字投影；只用颜色、字号和字重表达层级。

## 4. Component Stylings

### Buttons
```css
.ui-button {
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 0 15px;
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font: 600 13px/1.4 var(--font-sans);
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 120ms ease;
}
.ui-button:hover:not(:disabled) { background: var(--color-accent-hover); }
.ui-button:active:not(:disabled) { background: var(--color-accent-strong); transform: translateY(1px); }
.ui-button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; box-shadow: 0 0 0 4px rgb(var(--rgb-accent) / 0.14); }
.ui-button:disabled, .ui-button[aria-disabled="true"] { background: var(--color-surface-alt); border-color: var(--color-border); color: var(--color-text-tertiary); cursor: not-allowed; }
.ui-button-secondary { background: var(--color-surface); border-color: var(--color-border); color: var(--color-text); }
.ui-button-secondary:hover:not(:disabled) { background: var(--color-surface-hover); border-color: var(--color-border-hover); }
```

### Cards
```css
.ui-card { border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-surface); box-shadow: 0 2px 10px rgb(var(--rgb-text) / 0.035); transition: border-color 160ms ease, box-shadow 160ms ease; }
.ui-card:hover { border-color: var(--color-border-hover); box-shadow: 0 8px 22px rgb(var(--rgb-text) / 0.07); }
.ui-card:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px rgb(var(--rgb-accent) / 0.12); }
.ui-card:active { box-shadow: 0 2px 8px rgb(var(--rgb-text) / 0.05); }
```

### Navigation
```css
.ui-nav-item { min-height: 40px; border-radius: 9px; color: var(--color-text-secondary); transition: background-color 140ms ease, color 140ms ease; }
.ui-nav-item:hover { background: var(--color-surface-hover); color: var(--color-text); }
.ui-nav-item[aria-current="page"] { background: var(--color-accent-soft); color: var(--color-accent-strong); font-weight: 600; }
.ui-nav-item:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ui-nav-item:active { background: var(--color-accent-soft); }
.ui-nav-item[aria-disabled="true"] { color: var(--color-text-tertiary); cursor: not-allowed; }
```

### Links
```css
.ui-link { color: var(--color-accent-strong); text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; transition: color 140ms ease, text-decoration-color 140ms ease; }
.ui-link:hover { color: var(--color-accent-hover); text-decoration-color: currentColor; }
.ui-link:active { color: var(--color-accent-strong); }
.ui-link:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
.ui-link[aria-disabled="true"] { color: var(--color-text-tertiary); pointer-events: none; }
```

### Tags / Badges
```css
.ui-badge { display: inline-flex; min-height: 24px; align-items: center; border: 1px solid var(--color-border); border-radius: 999px; padding: 2px 9px; background: var(--color-surface); color: var(--color-text-secondary); font: 500 12px/1.4 var(--font-sans); }
.ui-badge:hover { border-color: var(--color-border-hover); background: var(--color-surface-hover); }
.ui-badge:active { background: var(--color-surface-alt); }
.ui-badge:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ui-badge[aria-disabled="true"] { opacity: 0.55; }
.ui-badge-accent { border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent-strong); }
```

### Inputs, dialogs, and status
```css
.ui-input { min-height: 42px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); color: var(--color-text); }
.ui-input:hover:not(:disabled) { border-color: var(--color-border-hover); }
.ui-input:focus-visible { outline: 2px solid rgb(var(--rgb-accent) / 0.22); border-color: var(--color-accent); }
.ui-input:active { border-color: var(--color-accent); }
.ui-input:disabled { background: var(--color-surface-alt); color: var(--color-text-tertiary); cursor: not-allowed; }
.ui-dialog { border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-surface); box-shadow: 0 24px 64px rgb(var(--rgb-overlay) / 0.2); }
.ui-toast { border: 1px solid var(--color-success-soft); border-radius: 12px; background: var(--color-surface); color: var(--color-text); box-shadow: 0 10px 30px rgb(var(--rgb-text) / 0.12); }
```

Concept image fields use a compact upload tile with a local preview, replace/remove actions, and a visible file-size limit. Keep the dialog content within the viewport; place bilingual fields side by side when space permits. Narrow or short viewports may scroll inside the form, with the scrollbar visually hidden while preserving keyboard and touch scrolling.

## 5. Layout Principles

**Container:**
- Max width: 1440px for dashboard and card library; topbar stays full width.
- Desktop navigation: 232–240px sidebar; header 68px high.
- Content padding: 28–40px desktop, 24px tablet, 16px mobile.
- Text-heavy detail: max-width 780px.

**Spacing Scale:**
- Section spacing: 24–32px.
- Component gap: 12–20px.
- Card internal padding: 16–20px.
- Compact controls: 8px internal gap; fields in editor: 12–16px gap.

**Grid:**
```css
.dashboard-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.concept-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.workspace-grid { display: grid; grid-template-columns: 232px minmax(320px, 400px) minmax(360px, 1fr); min-height: calc(100vh - 140px); }
@media (max-width: 1279px) { .dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .concept-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .workspace-grid { grid-template-columns: minmax(220px, 0.7fr) minmax(300px, 1fr); } .workspace-detail { grid-column: 1 / -1; } }
@media (max-width: 767px) { .dashboard-grid, .concept-grid, .workspace-grid { grid-template-columns: minmax(0, 1fr); } .workspace-list { max-height: 420px; overflow: auto; } }
```

Desktop prioritizes quick scanning and persistent context. Tablet uses two-column cards and moves workspace detail below the list. Mobile places navigation in normal flow, uses one-column cards, and stacks filters → results → detail without horizontal overflow.

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | no shadow; surface separated by border | inputs, filter rail, data groupings |
| Subtle | `0 2px 10px rgb(var(--rgb-text) / .035)` | dashboard cards and cards at rest |
| Elevated | `0 8px 22px rgb(var(--rgb-text) / .07)` | hovered card or popover |
| Overlay | `0 24px 64px rgb(var(--rgb-overlay) / .20)` | editor dialog |

Use one elevation level per surface. The dashboard and card library use a pale background with white panels; avoid nested shadows.

## 7. Animation & Interaction

**Motion Philosophy**: Motion confirms a state change; it never delays reading or changes page position.
**Tier**: L1.

### Dependencies
```text
No animation dependency. Use CSS transitions and keyframes only.
```

### Base Setup
```css
* { scroll-behavior: auto; }
button, a, input, textarea, select, [role="button"] { transition-duration: 140ms; }
```

### Entrance Animation
```css
@keyframes page-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.page-enter { animation: page-enter 220ms cubic-bezier(.2, .7, .2, 1) both; }
```

### Scroll Behavior
```css
/* No scroll reveal, parallax, pinning, or scroll hijacking in this information-dense admin UI. */
```

### Hover & Focus States
```css
:where(button, a, input, textarea, select, [role="button"]):focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
:where(button, a, [role="button"]):active:not(:disabled) { transform: translateY(1px); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }
```

### Special Effects
Card hover changes border/shadow and may gently zoom its cover image. Save/delete toasts fade in and out. No cursor effects, auto-scrolling, animated counters, or continuously moving backgrounds.

## 8. Do's and Don'ts

### Do
- Keep the temporary-demo badge visible in every layout.
- Keep Dashboard sample metrics marked as pending/provisional.
- Show the same active language in content, image, and navigation state.
- Use the accent color consistently for primary actions and active navigation.
- Preserve visible focus indicators for keyboard users.
- Give mobile controls at least 44px touch targets.
- Use actual Concept imagery where present and a composed image fallback when it is missing.
- Keep create/edit feedback brief and identify that data stays in memory.

### Don't
- ❌ Add hard-coded color values to component markup or utility classes.
- ❌ Shrink Chinese descriptions below 15px or reduce their line height below 1.7.
- ❌ Use color alone to identify status; keep text labels or a shape cue.
- ❌ Hide the current language or selected navigation item.
- ❌ Make mobile navigation overlap page content or depend on absolute offsets.
- ❌ Add parallax, scroll reveal, cursor tracking, or scroll hijacking to this admin flow.
- ❌ Use hover lift on dense dashboard cards; it makes alignment jump.
- ❌ Present example readiness, revisions, or counts as real usage analytics.
- ❌ Introduce persistence, a database, remote model calls, or out-of-scope features.

## 9. Responsive Behavior

**Breakpoints:**
| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 1279px | fixed sidebar; 4 KPI columns; 3-column workspace |
| Tablet | 700–1279px | compact navigation; 2-column cards; workspace details follow list |
| Mobile | < 700px | normal-flow top navigation; 1-column cards; stacked workspace panels |

**Touch Targets:** minimum 44×44px for primary interactive controls; dense icon actions may use 40px only above mobile breakpoints.
**Collapsing Strategy:** The desktop sidebar becomes an inline top navigation on small screens. Dashboard metrics reduce to two columns on tablet and one/two columns on narrow mobile. Card covers keep a stable aspect ratio. Workspace filter, result list, and selected detail become sequential panels; internal scrolling is limited to the results list on narrow screens.

```css
@media (max-width: 1279px) {
  .desktop-sidebar { display: none; }
  .mobile-navigation { display: flex; position: static; }
  .workspace-grid { grid-template-columns: minmax(0, 1fr); }
  .workspace-list { height: auto; max-height: 420px; }
}
@media (max-width: 767px) {
  body { min-width: 320px; }
  .page-content { padding-inline: 16px; }
  .concept-grid, .workspace-grid { grid-template-columns: minmax(0, 1fr); }
  .interactive-control { min-height: 44px; }
}
```
