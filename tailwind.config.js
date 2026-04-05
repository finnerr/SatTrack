/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#060811',
          900: '#0a0e1a',
          800: '#0f1629',
          700: '#1a2340',
          600: '#243058',
        },
      },
    },
  },
  plugins: [],
}

