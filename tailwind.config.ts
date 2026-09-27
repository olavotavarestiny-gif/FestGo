import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#151321",
        violet: {
          DEFAULT: "#8A2BE2",
          100: "#F1E5FF",
          200: "#E0C2FF",
          300: "#C68BFF",
          400: "#A855F7",
        },
        deep: "#421078",
        lavender: "#E8D7FF",
      },
      boxShadow: { glow: "0 20px 70px rgba(138,43,226,.28)" },
      fontFamily: { sans: ["var(--font-manrope)", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
