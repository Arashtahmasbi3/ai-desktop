/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0a0a0a',
        'bg-secondary': '#141414',
        'bg-tertiary': '#1e1e1e',
        border: '#2a2a2a',
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#6b4ce6',
          muted: '#4c3a99'
        }
      },
      fontFamily: {
          sans: ['Inter', 'Vazirmatn', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
