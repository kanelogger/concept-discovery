/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#17212d", muted: "#778391", line: "#e8ebef", canvas: "#f6f7f9", brand: "#416b5b" }, boxShadow: { panel: "0 12px 34px rgba(21, 35, 47, .055)" } } },
  plugins: []
};
