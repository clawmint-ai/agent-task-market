import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './landing.html', './app.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // gold accent (matches the published brand)
        brand: {
          50: '#fdf8e7', 100: '#fbeec2', 200: '#f7df90', 300: '#f3cf5e',
          400: '#f5c542', 500: '#e0aa1f', 600: '#b8860b', 700: '#946a00',
          800: '#6f5000', 900: '#5c4200',
        },
        // warm neutral foundation
        ink: {
          50: '#f7f7f6', 100: '#eceae7', 200: '#d9d6d0', 300: '#b8b3aa',
          400: '#8f8a7e', 500: '#6b665b', 600: '#514d44', 700: '#3d3a33',
          800: '#272521', 900: '#17150f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        display: ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        h2: ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23,21,15,.04), 0 1px 3px rgba(23,21,15,.08)',
        pop: '0 8px 30px rgba(23,21,15,.12)',
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem' },
    },
  },
  plugins: [],
} satisfies Config;
