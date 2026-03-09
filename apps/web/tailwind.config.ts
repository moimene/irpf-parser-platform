import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--g-brand-3308)",
          bright: "var(--g-brand-bright)",
        },
        secondary: {
          700: "var(--g-sec-700)",
          300: "var(--g-sec-300)",
          100: "var(--g-sec-100)",
        },
        surface: {
          page: "var(--g-surface-page)",
          card: "var(--g-surface-card)",
          subtle: "var(--g-surface-subtle)",
          muted: "var(--g-surface-muted)",
        },
        text: {
          primary: "var(--g-text-primary)",
          secondary: "var(--g-text-secondary)",
          inverse: "var(--g-text-inverse)",
        },
        border: {
          DEFAULT: "var(--g-border-default)",
          subtle: "var(--g-border-subtle)",
          focus: "var(--g-border-focus)",
        },
        status: {
          success: "var(--status-success)",
          warning: "var(--status-warning)",
          error: "var(--status-error)",
          info: "var(--status-info)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          accent: "var(--sidebar-accent)",
          border: "var(--sidebar-border)",
        },
      },
      borderRadius: {
        sm: "var(--g-radius-sm)",
        md: "var(--g-radius-md)",
        lg: "var(--g-radius-lg)",
        xl: "var(--g-radius-xl)",
        full: "var(--g-radius-full)",
      },
      boxShadow: {
        card: "var(--g-shadow-card)",
        "card-hover": "var(--g-shadow-card-hover)",
      },
      fontFamily: {
        sans: ["var(--g-font-family)"],
      },
      transitionDuration: {
        fast: "150ms",
        normal: "220ms",
      },
    },
  },
  plugins: [],
};

export default config;
