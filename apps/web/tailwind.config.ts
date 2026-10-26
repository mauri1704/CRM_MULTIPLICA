import type { Config } from 'tailwindcss';

/** Colores definidos como variables CSS (src/index.css) para el modo claro y oscuro. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        muted: token('muted'),
        border: token('border'),
        fg: token('fg'),
        'fg-muted': token('fg-muted'),
        primary: { DEFAULT: token('primary'), fg: token('primary-fg') },
        danger: { DEFAULT: token('danger'), fg: token('danger-fg') },
        success: token('success'),
        warning: token('warning'),
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
