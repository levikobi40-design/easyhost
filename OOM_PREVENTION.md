# OOM Prevention – Heavy Libraries Removed

To prevent out-of-memory (OOM) crashes:

- **qrcode.react** – Removed. Maya chat uses a simple placeholder instead of generating QR codes.
- **animate.css** – Removed. Animations use local CSS keyframes only.
- **framer-motion** – Not used. Chat drag uses plain DOM events.

**Kept:** `recharts` is used by PremiumDashboard for charts. It is lazy-loaded and should not cause OOM under normal use. If issues persist, consider replacing with lightweight alternatives (e.g. lightweight-charts or simple SVG).
