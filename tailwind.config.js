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
      },
      // v2.6.4 Fix F: one type scale for the dense UI chrome. Size-only tokens
      // (no line-height) so they swap in for the old arbitrary `text-[Npx]`
      // values without shifting any layout.
      fontSize: {
        '4xs': '9px',
        '3xs': '10px',
        '2xs': '11px'
      }
    }
  },
  plugins: []
}
