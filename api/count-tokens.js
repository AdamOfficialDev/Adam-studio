export const config = {
  runtime: 'edge',
};

let roundRobinCursor = Math.floor(Math.random() * 1000);

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

function buildAttachmentParts(att) {
  if (!att) return [];
  if (att.kind === 'text' && typeof att.textContent === 'string') {
    return [
      {
        text: `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``,
      },
    ];
  }
  if (att.mimeType && att.data) {
    return [
      {
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      },
    ];
  }
  return [];
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const { model = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen', attachment } = body || {};

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;

  if (!attachment || apiKeys.length === 0) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const parts = buildAttachmentParts(attachment);
  if (parts.length === 0) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:countTokens`;

  const startOffset = roundRobinCursor % apiKeys.length;
  roundRobinCursor = (roundRobinCursor + 1) % apiKeys.length;

  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[(startOffset + i) % apiKeys.length];
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
        const json = await upstream.json();
        if (typeof json?.totalTokens === 'number') {
          return Response.json({ ok: true, totalTokens: json.totalTokens });
        }
      }
    } catch {
      // Coba key berikutnya
    }
  }

  return Response.json({ ok: false }, { status: 502 });
}
