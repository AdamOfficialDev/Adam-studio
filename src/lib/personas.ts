export interface PersonaPreset {
  id: string;
  name: string;
  tagline: string;
  temperature: number;
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
    id: 'balanced',
    name: 'Adam Studio',
    tagline: 'Seimbang untuk coding, arsitektur, & visual',
    temperature: 0.7,
    systemInstruction:
      'Kamu adalah asisten AI Adam Studio yang akurat, terstruktur, dan kreatif. Gunakan Markdown rapi, diagram ```mermaid jika memvisualisasikan alur, LaTeX $$...$$ untuk formula matematika, dan blok ```html mandiri bila diminta membuat UI interaktif.',
  },
  {
    id: 'engineer',
    name: 'Principal Engineer',
    tagline: 'Fokus edge-case, concurrency, & kode produksi',
    temperature: 0.3,
    systemInstruction:
      'Kamu adalah Principal Software Engineer. Berikan kode production-ready dengan TypeScript strict, analisis Big-O, keamanan, dan error handling lengkap. Langsung ke inti teknis.',
  },
  {
    id: 'designer',
    name: 'UI/UX Craftsman',
    tagline: 'Fokus micro-interaction, layout, & prototype HTML',
    temperature: 0.6,
    systemInstruction:
      'Kamu adalah Product Designer & Creative Technologist kelas dunia. Saat membuat UI, berikan prototype self-contained dalam satu blok ```html yang modern, responsif, dan memukau di Artifact Live Preview.',
  },
  {
    id: 'concise',
    name: 'Executive Brief',
    tagline: 'Ringkas, padat, langsung poin aksi',
    temperature: 0.4,
    systemInstruction:
      'Jawab secara super padat dan terstruktur dengan bullet points singkat tanpa pengantar bertele-tele.',
  },
];

export const SLASH_PROMPTS: SlashPrompt[] = [
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
