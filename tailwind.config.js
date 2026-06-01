/** @type {import('tailwindcss').Config} */

// Colours are driven by CSS variables (see src/styles/index.css) so a dark
// theme can later be added by swapping the variables under a `.dark` scope —
// no component changes. Variables hold space-separated RGB channels, wrapped
// here with <alpha-value> so Tailwind opacity modifiers (bg-brand/50) work.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class', // readiness only — no dark palette implemented yet
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent (construction orange). DEFAULT + named soft variants,
        // plus the numeric rungs older auth components already reference.
        brand: {
          DEFAULT: v('brand'),
          dark: v('brand-dark'),
          soft: v('brand-soft'),
          'soft-2': v('brand-soft-2'),
          50: v('brand-soft'),
          100: v('brand-soft-2'),
          300: v('brand-soft-2'),
          500: v('brand'),
          600: v('brand'),
          700: v('brand-dark'),
        },
        // Semantic surfaces / text — use these instead of hardcoded greys.
        canvas: v('canvas'),
        surface: {
          DEFAULT: v('surface'),
          sunken: v('surface-sunken'),
        },
        border: v('border'),
        primary: v('text-primary'),
        secondary: v('text-secondary'),
        muted: v('text-muted'),
        faint: v('text-faint'),
        ink: {
          DEFAULT: v('ink'),
          2: v('ink-2'),
        },
        // Status colours (badges, accents) + their soft backgrounds.
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        amber: { DEFAULT: v('amber'), soft: v('amber-soft') },
        info: { DEFAULT: v('blue'), soft: v('blue-soft') },
        danger: { DEFAULT: v('red'), soft: v('red-soft') },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,20,25,0.04)',
        'card-md': '0 4px 12px rgba(15,20,25,0.06)',
        'card-lg': '0 20px 40px rgba(15,20,25,0.10)',
        cta: '0 4px 16px rgba(242,107,31,0.32)',
      },
      maxWidth: {
        app: '1280px',
      },
    },
  },
  plugins: [],
};
