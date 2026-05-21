/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./popup.html'],
  theme: {
    extend: {
      colors: {
        'bb-blue': '#3665f3',
        'bb-green': '#5cb85c',
        'bg-primary': '#0f1117',
        'bg-secondary': '#161822',
        'text-primary': '#e8eaf0',
        'text-secondary': '#8b8fa3',
        'text-muted': '#575b6e',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
};
