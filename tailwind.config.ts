import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Jobber-inspired color palette
        jobber: {
          // Sidebar/Navigation - Dark teal
          sidebar: '#1B4B5A',
          'sidebar-hover': '#234F5E',
          'sidebar-active': '#2A5F6F',
          // Primary green for CTAs
          green: {
            DEFAULT: '#16A34A',
            50: '#DCFCE7',
            100: '#BBF7D0',
            200: '#86EFAC',
            300: '#4ADE80',
            400: '#22C55E',
            500: '#16A34A',
            600: '#15803D',
            700: '#166534',
          },
          // Accent teal
          teal: {
            DEFAULT: '#0D9488',
            50: '#F0FDFA',
            100: '#CCFBF1',
            500: '#14B8A6',
            600: '#0D9488',
            700: '#0F766E',
          },
        },
      },
      boxShadow: {
        'jobber': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'jobber-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [],
};
export default config;
