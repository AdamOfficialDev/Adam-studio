export interface EnhancePromptOptions {
  prompt: string;
  model: string;
  builderMode?: boolean;
  apiKey?: string;
  demoMode?: boolean;
  signal?: AbortSignal;
  onStream?: (partialText: string) => void;
}

export interface EnhancePromptResult {
  enhancedText: string;
  usedFallback: boolean;
  modelUsed: string;
}

function readStoredApiKey(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const settingsRaw = window.localStorage.getItem('adam_studio_settings');
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw) as Record<string, unknown>;
      if (typeof parsed?.apiKey === 'string' && parsed.apiKey.trim()) {
        return parsed.apiKey.trim();
      }
    }
  } catch {
    // ignore storage errors
  }
  return undefined;
}

export function enhancePromptLocally(rawPrompt: string, builderMode = false): string {
  const clean = rawPrompt.trim();
  if (!clean) return '';

  if (builderMode) {
    return [
      'Bangun implementasi production-grade untuk permintaan berikut:',
      clean,
      '',
      'Persyaratan Teknis & Kualitas:',
      '- Arsitektur modular dengan pemisahan komponen, state, dan tipe data yang jelas.',
      '- Tangani seluruh state (loading, empty, error) serta validasi edge-case secara utuh tanpa placeholder.',
      '- Antarmuka responsif mobile-first (360px hingga desktop), kontras tinggi, dan aksesibel.',
    ].join('\n');
  }

  return [
    'Tolong bantu secara terstruktur, akurat, dan mendalam untuk permintaan berikut:',
    clean,
    '',
    'Kriteria Jawaban:',
    '- Berikan penjelasan inti yang langsung ke pokok persoalan beserta alasan teknisnya.',
    '- Jika menyertakan kode atau langkah kerja, pastikan utuh, konsisten, dan siap dijalankan.',
  ].join('\n');
}

function cleanEnhancedOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned
      .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  }
  return cleaned;
}

export async function enhancePromptWithModel(
  options: EnhancePromptOptions
): Promise<EnhancePromptResult> {
  const {
    prompt,
    model,
    builderMode = false,
    apiKey,
    demoMode = false,
    signal,
    onStream,
  } = options;

  const trimmed = prompt.trim();
  const activeModel = (model || 'gemini-3.8-flash').trim();

  if (!trimmed) {
    return { enhancedText: '', usedFallback: false, modelUsed: activeModel };
  }

  if (demoMode) {
    const local = enhancePromptLocally(trimmed, builderMode);
    onStream?.(local);
    return { enhancedText: local, usedFallback: true, modelUsed: activeModel };
  }

  const resolvedKey = (apiKey && apiKey.trim()) || readStoredApiKey();
  const normalizedKeys = (resolvedKey || '')
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  const systemInstruction = [
    'Kamu adalah Principal Prompt Engineer di Adam Studio.',
    'Tugasmu adalah menyempurnakan draf prompt pengguna menjadi prompt yang lebih jelas, terstruktur, spesifik, dan siap menghasilkan output kualitas tinggi.',
    'Aturan wajib:',
    '1. Pertahankan seluruh maksud, konteks, nama file, variabel, atau kutipan asli pengguna.',
    '2. Gunakan bahasa yang sama dengan prompt pengguna (Indonesia/Inggris/campuran).',
    '3. Jangan menjawab pertanyaannya — keluarkan HANYA teks prompt hasil penyempurnaan tanpa kata pengantar atau pembungkus markdown code fence.',
    builderMode
      ? '4. Karena mode App Builder aktif, tekankan arsitektur modular, responsivitas UI, state handling lengkap, dan zero placeholder.'
      : '4. Jaga agar tetap ringkas, padat, dan langsung bisa dieksekusi oleh model AI.',
  ].join('\n');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: activeModel,
        messages: [
          {
            role: 'user',
            content: `Sempurnakan draf prompt berikut:\n\n${trimmed}`,
          },
        ],
        builderMode: builderMode ? 'emergent' : 'chat',
        systemInstruction,
        maxOutputTokens: 2048,
        includeThoughts: false,
        thinkingLevel: 'off',
        autoFallbackOnOverload: true,
        fallbackModel: 'gemini-3.8-flash',
        enableGoogleSearch: false,
        enableUrlContext: false,
        demoMode: false,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    const processBlock = (rawBlock: string) => {
      if (!rawBlock.trim() || rawBlock.startsWith(':')) return;

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of rawBlock.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim().toLowerCase();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length === 0) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        return;
      }

      if (eventName === 'error') {
        throw new Error(
          typeof parsed.message === 'string' ? parsed.message : 'Gagal menyempurnakan prompt'
        );
      }

      if (eventName === 'delta' && typeof parsed.text === 'string') {
        accumulated += parsed.text;
        onStream?.(cleanEnhancedOutput(accumulated));
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundaryIndex: number;
      while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawBlock = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        processBlock(rawBlock);
      }
    }

    if (buffer.trim()) {
      processBlock(buffer);
    }

    const finalResult = cleanEnhancedOutput(accumulated);
    if (!finalResult) {
      throw new Error('Model tidak mengembalikan teks hasil enhance');
    }

    return {
      enhancedText: finalResult,
      usedFallback: false,
      modelUsed: activeModel,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const local = enhancePromptLocally(trimmed, builderMode);
    onStream?.(local);
    return {
      enhancedText: local,
      usedFallback: true,
      modelUsed: activeModel,
    };
  }
}
