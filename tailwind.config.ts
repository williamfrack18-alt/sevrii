import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-geist-sans)", "-apple-system", "Helvetica", "Arial", "sans-serif"],
        sans: ["var(--font-geist-sans)", "-apple-system", "Helvetica", "Arial", "sans-serif"],
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
        // Provider panel (see lib/panel.ts)
        pbg: "#F5F5F3",
        pcard: "#FFFFFF",
        psoft: "#F0F0ED",
        pfg: "#0A0A0A",
        pfg2: "#27272A",
        psub: "#52525B",
        pmuted: "#71717A",
        pfaint: "#A1A1AA",
        pgreen: "#16A34A",
        pdeep: "#052E16",
      },
      borderRadius: {
        xl2: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
