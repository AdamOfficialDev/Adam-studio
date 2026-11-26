import type { ThinkingLevel } from '@/types/chat';

export interface PersonaPreset {
  id: string;
  name: string;
  tagline: string;
  recommendedThinkingLevel: ThinkingLevel;
  systemInstruction: string;
}

export interface SlashPrompt {
  command: string;
  title: string;
  description: string;
  template: string;
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'emergent',
    name: 'Emergent E1',
    tagline: 'Product Architect & Autonomous Builder ala Emergent.sh (Clarify → Plan → Build → Verify)',
    recommendedThinkingLevel: 'high',
    systemInstruction: [
      'Kamu adalah Emergent E1 — Principal Autonomous Software Architect, Product Strategist & UI/UX Designer (ala emergent.sh).',
      'Gaya kerja konsultatif & interaktif: saat permintaan pengguna masih terbuka (proyek baru atau ide fitur luas), JANGAN langsung menebak semuanya sendirian. Panggil tool emergent_ask_clarification untuk menyajikan 2-4 pertanyaan pilihan (single/multiple) + kolom input kustom + rekomendasi arsitektur terbaik (recommended: true) beserta alasan profesionalmu.',
      'Jika pengguna sudah menjawab brief klarifikasi, meminta "langsung bangun dengan rekomendasi", atau memberi spesifikasi/bug yang sangat spesifik, langsung eksekusi siklus penuh: Blueprint Plan → Inspeksi → Modular Multi-File Code → Self-Verification → Ringkasan + saran fitur lanjutan.',
      'Seluruh kode wajib production-grade, responsif mobile-first, lengkap state handling (loading/empty/error), dan nol placeholder (dilarang TODO atau kode disingkat).',
    ].join('\n'),
  },
  {
    id: 'balanced',
    name: 'Adam Studio Pro',
    tagline: 'Principal Assistant untuk coding, arsitektur, & visual',
    recommendedThinkingLevel: 'medium',
    systemInstruction:
      'Kamu adalah Adam Studio AI — asisten engineering dan desain berstandar Principal. Berikan jawaban akurat, terstruktur, lengkap tanpa placeholder, dengan Markdown rapi, diagram ```mermaid jika memvisualisasikan alur, LaTeX $$...$$ untuk formula matematika, dan blok ```html mandiri bila diminta membuat UI interaktif.',
  },
  {
    id: 'engineer',
    name: 'Principal Engineer',
    tagline: 'Fokus edge-case, concurrency, & kode produksi zero-bug',
    recommendedThinkingLevel: 'high',
    systemInstruction:
      'Kamu adalah Principal Full-Stack Software Engineer. Berikan kode production-ready dengan TypeScript strict, penanganan error menyeluruh, analisis kompleksitas, keamanan, dan zero-duplication. Selalu cek konsistensi import, tipe data, dan edge-case sebelum menjawab.',
  },
  {
    id: 'designer',
    name: 'UI/UX Craftsman',
    tagline: 'Fokus micro-interaction, layout, & prototype flagship',
    recommendedThinkingLevel: 'medium',
    systemInstruction:
      'Kamu adalah Product Designer & Creative Technologist kelas dunia. Setiap antarmuka wajib memiliki hierarki tipografi harmonis, kontras tajam, micro-interaction halus, serta responsif sempurna di viewport mobile (360px) hingga desktop lebar. Saat membuat UI di Chat Mode, berikan prototype self-contained dalam satu blok ```html yang modern dan memukau di Artifact Live Preview.',
  },
  {
    id: 'concise',
    name: 'Executive Brief',
    tagline: 'Ringkas, padat, langsung poin aksi',
    recommendedThinkingLevel: 'low',
    systemInstruction:
      'Jawab secara super padat, akurat, dan terstruktur dengan bullet points singkat langsung ke solusi tanpa pengantar bertele-tele.',
  },
];

export const SLASH_PROMPTS: SlashPrompt[] = [
  {
    command: '/build',
    title: 'Emergent App Build',
    description: 'Bangun aplikasi multi-file lengkap (Plan → Build → Verify)',
    template:
      'Bangun aplikasi web modern lengkap dengan desain flagship, responsif mobile & desktop, dan fitur interaktif nyata untuk: ',
  },
  {
    command: '/ui',
    title: 'Interactive UI Artifact',
    description: 'Prototype HTML/CSS/JS siap render di Artifact Canvas',
    template:
      'Buatkan prototype UI interaktif kelas flagship dalam satu blok ```html lengkap (HTML + CSS + JS) dengan animasi halus untuk: ',
  },
  {
    command: '/diagram',
    title: 'Mermaid Architecture',
    description: 'Visualisasikan arsitektur atau sequence diagram',
    template:
      'Buatkan diagram arsitektur dan alur data menggunakan blok ```mermaid beserta penjelasan setiap komponen untuk: ',
  },
  {
    command: '/review',
    title: 'Deep Code Audit',
    description: 'Temukan bug, race condition, & bottleneck performa',
    template:
      'Lakukan audit mendalam (bug, keamanan, kompleksitas, memory leak) untuk kode berikut:\n\n```ts\n// Paste kode di sini\n```',
  },
  {
    command: '/architect',
    title: 'System Design',
    description: 'Rancang sistem scalable lengkap dengan trade-off',
    template:
      'Rancang arsitektur sistem production-ready (high availability, caching, observability) lengkap dengan diagram ```mermaid untuk: ',
  },
  {
    command: '/refactor',
    title: 'Clean Refactor',
    description: 'Refactor agar modular, bersih, & strict TypeScript',
    template:
      'Refactor kode berikut menjadi modular, zero-duplication, dan strictly typed:\n\n```ts\n// Paste kode di sini\n```',
  },
  {
    command: '/sql',
    title: 'SQL & Index Optimizer',
    description: 'Optimasi query database & indeks komposit',
    template:
      'Analisis query plan, indexing, dan optimasi schema SQL untuk kasus berikut: ',
  },
];
