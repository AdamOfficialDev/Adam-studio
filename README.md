# Adam Studio — Gemini 4 AI Workspace

Platform chatbot AI real-time SSE berbasis **Vite + React + TypeScript + shadcn/ui** dengan fokus maksimal pada estetika UI/UX, performa 60fps, dan kapabilitas Artifact Studio.

## Fitur Utama
- **Vite + shadcn/ui + Framer Motion + cmdk + Sonner + OverlayScrollbars**
- **4 Theme Skins**: Obsidian Pro, Claude Dusk, Cyber Aurora, dan Paper Editorial
- **Zero-Lag SSE Engine**: isolated streaming state + adaptive flush + custom floating OverlayScrollbars
- **Artifact Studio IDE**: CodeMirror 6 Live Editor, Sandbox Preview (dengan `localStorage` shim), Console output, Device Frame Switcher, & Mermaid/KaTeX
- **Productivity**: Command Palette (`Ctrl+K`), Zen Focus Mode (`Ctrl+\`), Slash Commands (`/`), Edit & Resend, Fork Thread, Read Aloud (TTS), & Starred Bookmarks
- **Deploy Ready**: Mendukung local (`pnpm dev`) dan Vercel Edge Runtime (`api/chat.js` + `api/health.js`)

## Menjalankan (`pnpm`)
```bash
pnpm install
pnpm dev
```
