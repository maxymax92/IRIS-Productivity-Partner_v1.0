import type { Config } from 'tailwindcss'

// Tailwind CSS v4: Plugins are now loaded via @plugin directive in CSS (globals.css)
// This config file is loaded via @config directive in CSS

const config: Config = {
  content: [
    // Next.js app
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
    // UI components (from root)
    '../../ui/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // ===========================================
      // TYPOGRAPHY (colors are CSS variables in globals.css)
      // ===========================================
      fontFamily: {
        sans: ['Satoshi', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.5rem', { lineHeight: '2rem' }],
      },
      letterSpacing: {
        tight: '-0.025em',
        normal: '-0.01em',
        wide: '0.05em',
        display: '0.3em',
      },

      // ===========================================
      // SPACING & SIZING
      // ===========================================
      spacing: {
        header: '48px',
        'tab-bar': '44px',
        touch: '44px',
        input: '36px',
        'canvas-inset': '1.5rem',
        sidebar: '264px',
        'sidebar-offset': '300px',
        'sidebar-mobile': 'min(264px, 85vw)',
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
      },
      maxWidth: {
        content: '800px',
        message: '95%',
        'truncate-sm': '100px',
        settings: '900px',
        'command-list': '400px',
      },
      maxHeight: {
        textarea: '200px',
        settings: '85vh',
        'command-list': '400px',
      },
      minHeight: {
        canvas: 'calc(100vh - 5rem)',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        pill: '9999px',
        sidebar: '60px',
      },

      // ===========================================
      // BLUR (backdrop-blur-*, blur-*) — semantic glass
      // ===========================================
      blur: {
        glass: '40px',
        panel: '24px',
        subtle: '16px',
      },

      // ===========================================
      // SHADOWS — semantic (align with globals.css tokens)
      // ===========================================
      boxShadow: {
        sm: '0 1px 2px oklch(0% 0 0 / 0.3)',
        DEFAULT: '0 4px 6px oklch(0% 0 0 / 0.4)',
        md: '0 4px 6px oklch(0% 0 0 / 0.4)',
        lg: '0 10px 15px oklch(0% 0 0 / 0.5)',
        glow: '0 0 20px oklch(43.5% 0.012 45 / 0.15)',
        card: '0 4px 6px oklch(0% 0 0 / 0.4)',
        modal: '0 10px 15px oklch(0% 0 0 / 0.5)',
      },

      // ===========================================
      // MOTION TOKENS
      // ===========================================
      transitionDuration: {
        fast: '100ms',
        normal: '150ms',
        slow: '250ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0, 0, 0.2, 1)',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      // ===========================================
      // Z-INDEX
      // ===========================================
      zIndex: {
        dropdown: '10',
        sticky: '20',
        modal: '30',
        toast: '40',
        tooltip: '50',
      },
    },
  },
}

export default config
