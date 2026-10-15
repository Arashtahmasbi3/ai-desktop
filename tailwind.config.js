/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      /*
       * v2.7.0: every colour is a CSS variable, so the same class names render in
       * the light ("day") and dark themes. `rgb(var(--x) / <alpha-value>)` keeps
       * opacity modifiers working (`bg-danger/10`, `text-fg-muted/70`).
       *
       * The semantic names are the contract components should use:
       *   surfaces  bg-primary | bg-secondary | bg-tertiary | bg-elevated
       *   lines     border | border-strong
       *   text      fg-strong | fg | fg-muted | fg-subtle
       *   states    danger | warning | success | info
       *   brand     accent | accent-hover | accent-fg | accent-muted
       * A bare Tailwind palette class (text-neutral-500, bg-red-500/10, ...) is a
       * bug: it is theme-blind and breaks whichever theme it was not tuned for.
       * `test/renderer/theme-tokens.test.ts` enforces that.
       */
      colors: {
        'bg-primary': 'rgb(var(--bg-primary) / <alpha-value>)',
        'bg-secondary': 'rgb(var(--bg-secondary) / <alpha-value>)',
        'bg-tertiary': 'rgb(var(--bg-tertiary) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        'fg-strong': 'rgb(var(--fg-strong) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-subtle': 'rgb(var(--fg-subtle) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          muted: 'rgb(var(--accent-muted) / <alpha-value>)'
        },
        /*
         * A filled accent surface is its own token: on a near-black background the
         * accent must be light to read as text and dark to carry white text, and
         * one value cannot satisfy both (v2.7.0).
         */
        'accent-solid': 'rgb(var(--accent-solid) / <alpha-value>)',
        'accent-solid-hover': 'rgb(var(--accent-solid-hover) / <alpha-value>)'
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
      },
      /*
       * Clay depth (v3.0). Radius is a three-step scale on purpose: one big radius
       * everywhere reads as a toy, and a dense tool needs the small step for chips and
       * rows. The shadows read their colours from theme variables, so light and dark get
       * genuinely different depth instead of an inverted copy (see main.css).
       */
      borderRadius: {
        'clay-sm': 'var(--clay-r-sm)',
        clay: 'var(--clay-r-md)',
        'clay-lg': 'var(--clay-r-lg)',
        'clay-pill': 'var(--clay-r-pill)'
      },
      boxShadow: {
        clay: 'var(--clay-shadow-out)',
        'clay-soft': 'var(--clay-shadow-soft)',
        'clay-in': 'var(--clay-shadow-in)'
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)'
      },
      transitionTimingFunction: {
        clay: 'var(--ease-clay)'
      },
      zIndex: {
        sticky: 'var(--z-sticky)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)'
      },
      spacing: {
        'icon-sm': 'var(--icon-sm)',
        'icon-md': 'var(--icon-md)',
        'icon-lg': 'var(--icon-lg)'
      }
    }
  },
  plugins: []
}
