import type { Config } from "tailwindcss";
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        canvas: "var(--color-canvas)",
        surface: "var(--color-surface)",
        "surface-muted": "var(--color-surface-muted)",
        "surface-raised": "var(--color-surface-raised)",
        "input-border": "var(--color-input-border)",
        "primary-fill": "var(--color-primary-fill)",
        "primary-hover": "var(--color-primary-hover)",
        selection: "var(--color-selection)",
        scrollbar: "var(--color-scrollbar)",
        "success-soft": "var(--color-success-soft)",
        success: "var(--color-success)",
        "info-soft": "var(--color-info-soft)",
        info: "var(--color-info)",
        "warning-soft": "var(--color-warning-soft)",
        warning: "var(--color-warning)",
        "danger-soft": "var(--color-danger-soft)",
        danger: "var(--color-danger)",
        "violet-soft": "var(--color-violet-soft)",
        violet: "var(--color-violet)",

        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        line: "var(--color-line)",
      },
      boxShadow: { card: "0 3px 20px -8px rgba(30, 50, 55, .10)" },
    },
  },
  plugins: [],
} satisfies Config;
