import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f4ede1",
        "paper-2": "#ebe1cf",
        ink: "#141210",
        "ink-soft": "#2a2622",
        rule: "#1a1714",
        red: "#d2331f",
        "red-deep": "#a8270f",
        gold: "#b8893a",
        muted: "#6e655a",
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Inter Tight"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
