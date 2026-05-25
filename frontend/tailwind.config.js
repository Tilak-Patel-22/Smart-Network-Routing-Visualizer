/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      colors: {
        night: {
          950: "#05070f",
          900: "#0a0e1a",
          850: "#0f1526",
          800: "#141c32",
        },
        neon: {
          blue: "#38bdf8",
          cyan: "#22d3ee",
          orange: "#fb923c",
          amber: "#fbbf24",
          rose: "#fb7185",
        },
      },
      boxShadow: {
        glow: "0 0 24px rgba(56, 189, 248, 0.35)",
        glowOrange: "0 0 24px rgba(251, 146, 60, 0.4)",
        glowAmber: "0 0 20px rgba(251, 191, 36, 0.35)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
