export const config = {
  runtime: 'edge',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';

function parseKeyPool(...sources) {
  const pool = [];
  const seen = new Set();
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    for (const part of src.split(/[\r\n,;]+/)) {
      const k = part.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        pool.push(k);
      }
    }
  }
  return pool;
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { model = DEFAULT_MODEL, attachment } = body || {};

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;

  if (apiKeys.length === 0 || !attachment) {
    return new Response(JSON.stringify({ error: 'API key atau attachment tidak tersedia.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parts = [];
  if (attachment.kind === 'text' && typeof attachment.textContent === 'string') {
    parts.push({
      text: `[Attached File: ${attachment.name}]\n\`\`\`\n${attachment.textContent}\n\`\`\``,
    });
  } else if (attachment.mimeType && attachment.data) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    });
  }

  if (parts.length === 0) {
    return new Response(JSON.stringify({ error: 'Konten file kosong.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const candidateModels = [model, 'gemini-2.5-flash'].filter((v, i, a) => a.indexOf(v) === i);

  for (const targetModel of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel
    )}:countTokens`;

    for (const key of apiKeys.slice(0, 3)) {
      try {
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
          }),
        });

        if (upstream.ok) {
          const data = await upstream.json();
          if (typeof data?.totalTokens === 'number') {
            return new Response(
              JSON.stringify({ totalTokens: data.totalTokens, model: targetModel }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
        }
      } catch {
        // Coba key atau model berikutnya
      }
    }
  }

  return new Response(JSON.stringify({ error: 'Gagal menghitung token via countTokens API.' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
