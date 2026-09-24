/** @type {import('tailwindcss').Config} */
const palette = {
  white: "rgb(var(--rgb-surface) / <alpha-value>)",
  slate: {
    50: "rgb(var(--rgb-surface-soft) / <alpha-value>)",
    100: "rgb(var(--rgb-surface-alt) / <alpha-value>)",
    200: "rgb(var(--rgb-border) / <alpha-value>)",
    300: "rgb(var(--rgb-border-strong) / <alpha-value>)",
    400: "rgb(var(--rgb-text-tertiary) / <alpha-value>)",
    500: "rgb(var(--rgb-text-secondary) / <alpha-value>)",
    600: "rgb(var(--rgb-text-secondary) / <alpha-value>)",
    700: "rgb(var(--rgb-text) / <alpha-value>)",
    800: "rgb(var(--rgb-text) / <alpha-value>)",
    900: "rgb(var(--rgb-text) / <alpha-value>)",
    950: "rgb(var(--rgb-overlay) / <alpha-value>)",
  },
  amber: {
    50: "rgb(var(--rgb-warning-soft) / <alpha-value>)",
    100: "rgb(var(--rgb-warning-soft) / <alpha-value>)",
    200: "rgb(var(--rgb-warning-border) / <alpha-value>)",
    400: "rgb(var(--rgb-warning) / <alpha-value>)",
    500: "rgb(var(--rgb-warning) / <alpha-value>)",
    800: "rgb(var(--rgb-warning-strong) / <alpha-value>)",
  },
  emerald: {
    50: "rgb(var(--rgb-success-soft) / <alpha-value>)",
    200: "rgb(var(--rgb-success-border) / <alpha-value>)",
    500: "rgb(var(--rgb-success) / <alpha-value>)",
    700: "rgb(var(--rgb-success-strong) / <alpha-value>)",
  },
  rose: {
    50: "rgb(var(--rgb-error-soft) / <alpha-value>)",
    600: "rgb(var(--rgb-error) / <alpha-value>)",
    700: "rgb(var(--rgb-error-strong) / <alpha-value>)",
  },
};

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ...palette,
        ink: "rgb(var(--rgb-text) / <alpha-value>)",
        muted: "rgb(var(--rgb-text-secondary) / <alpha-value>)",
        line: "rgb(var(--rgb-border) / <alpha-value>)",
        canvas: "rgb(var(--rgb-bg) / <alpha-value>)",
        brand: "rgb(var(--rgb-accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--rgb-accent-hover) / <alpha-value>)",
        "accent-soft": "rgb(var(--rgb-accent-soft) / <alpha-value>)",
        "accent-muted": "rgb(var(--rgb-accent-muted) / <alpha-value>)",
        "accent-strong": "rgb(var(--rgb-accent-strong) / <alpha-value>)",
        "surface-alt": "rgb(var(--rgb-surface-alt) / <alpha-value>)",
        "surface-subtle": "rgb(var(--rgb-surface-soft) / <alpha-value>)",
        "surface-inverse": "rgb(var(--rgb-surface-inverse) / <alpha-value>)",
        "success-soft": "rgb(var(--rgb-success-soft) / <alpha-value>)",
        "warning-soft": "rgb(var(--rgb-warning-soft) / <alpha-value>)",
        "error-soft": "rgb(var(--rgb-error-soft) / <alpha-value>)",
      },
      boxShadow: {
        panel: "0 2px 10px rgb(var(--rgb-text) / .035)",
        "panel-hover": "0 8px 22px rgb(var(--rgb-text) / .07)",
        selected: "0 0 0 3px rgb(var(--rgb-accent) / .12)",
        switcher: "0 12px 35px rgb(var(--rgb-overlay) / .24)",
      },
      fontFamily: {
        sans: ["Noto Sans SC", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
