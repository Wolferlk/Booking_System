import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
          700: '#a16207',
          800: '#854d0e',
          900: '#713f12',
        },
        navy: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d7fe',
          300: '#a5bbfc',
          400: '#8098f9',
          500: '#6173f4',
          600: '#4c51e9',
          700: '#4040d1',
          800: '#3535a9',
          900: '#2f3085',
          950: '#1e1b4b',
        },
        slate: {
          850: '#1a2235',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'card-hover': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        'glow': '0 0 20px 2px rgb(234 179 8 / 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        // Ticket approvals: a request that is blocking a purchase is the one
        // thing on the tickets page allowed to move until somebody answers it.
        'urgent-glow': 'urgentGlow 1.5s ease-in-out infinite',
        'sheen': 'sheen 2.6s ease-in-out infinite',
        'breathe': 'breathe 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        urgentGlow: {
          '0%, 100%': { boxShadow: '0 2px 10px rgba(220,38,38,0.30)' },
          '50%':      { boxShadow: '0 6px 24px rgba(220,38,38,0.62)' },
        },
        sheen: {
          '0%':        { transform: 'translateX(-130%)' },
          '55%, 100%': { transform: 'translateX(150%)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.85)' },
          '50%':      { opacity: '1',   transform: 'scale(1.15)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}

export default config
