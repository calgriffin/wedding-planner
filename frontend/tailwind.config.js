/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ivory: {
          50: '#FDFBF7',
          100: '#FAF6ED',
          200: '#F5EDD9',
          300: '#EDE1BF',
          400: '#E2D19E',
          500: '#D6BD7A',
        },
        sage: {
          50: '#F0F4F0',
          100: '#DDE6DD',
          200: '#BBCDBB',
          300: '#90AD90',
          400: '#6B8E6B',
          500: '#527352',
          600: '#425D42',
          700: '#354835',
          800: '#2C3C2C',
          900: '#253125',
        },
        charcoal: {
          50: '#F5F5F5',
          100: '#E8E8E8',
          200: '#D1D1D1',
          300: '#AAAAAA',
          400: '#888888',
          500: '#6E6E6E',
          600: '#5A5A5A',
          700: '#4A4A4A',
          800: '#3D3D3D',
          900: '#333333',
          950: '#1A1A1A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
        // Guest website (matches the teaser / countdown pages)
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        jost: ['Jost', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}