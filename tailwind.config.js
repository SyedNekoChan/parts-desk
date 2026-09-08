/** @type {import('tailwindcss').Config} */
export default {
  // Class strategy rather than media: the toggle writes `dark` onto
  // <html>, so a chosen theme survives a change in OS appearance.
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      keyframes: {
        "glow-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.72" }
        },
        "sheen": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" }
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "sheen": "sheen 2.2s ease-in-out infinite",
        "fade-up": "fade-up .18s ease-out"
      }
    }
  },
  plugins: []
};
