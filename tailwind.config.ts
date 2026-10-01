import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "Helvetica", "Arial", "sans-serif"],
      },
      colors: {
        ink: "#122118",
        inkDeep: "#0E1712",
        cream: "#F6F4EF",
        mint: "#EFF3F1",
        border: "#E4E0D6",
        borderStrong: "#DAD6C9",
        muted: "#6E7268",
        mutedLight: "#9A968A",
        lime: "#C6F135",
      },
      borderRadius: {
        xl2: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
