import { handleDaytonaAction } from './_daytona.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, message: 'Invalid JSON' });
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, message: 'Invalid JSON' });
    return;
  }

  const readHeader = (name) => {
    const val = req.headers?.[name];
    return Array.isArray(val) ? String(val[0] || '').trim() : String(val || '').trim();
  };

  const apiKey = readHeader('x-daytona-api-key');
  const apiUrl = readHeader('x-daytona-api-url');
  const githubToken = readHeader('x-github-token') || process.env.GITHUB_TOKEN?.trim() || '';

  const ac = new AbortController();
  res.on?.('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const result = await handleDaytonaAction({
      action: body?.action,
      body,
      apiKey,
      apiUrl,
      githubToken,
      signal: ac.signal,
    });
    res.status(result.status).json(result.payload);
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err instanceof Error ? err.message : 'Daytona Sandbox error',
    });
  }
}
