export const config = {
  runtime: 'edge',
};

function countPoolKeys(...sources) {
  const seen = new Set();
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    for (const part of src.split(/[\r\n,;]+/)) {
      const k = part.trim();
      if (k) seen.add(k);
    }
  }
  return seen.size;
}

export default function handler() {
  const count = countPoolKeys(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const payload = {
    ok: true,
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-4-hydrogen',
    hasServerApiKey: count > 0,
    serverKeyCount: count,
    demoModeEnv: process.env.DEMO_MODE === 'true',
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
