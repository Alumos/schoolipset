import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a1020',
        canvas: '#f5f7fb',
        mint: '#b8f2dc',
        lime: '#d8f56a',
      },
      boxShadow: {
        soft: '0 18px 60px rgba(28, 40, 69, .08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
