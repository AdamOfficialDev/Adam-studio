import { handleDaytonaAction } from './_daytona.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Invalid JSON' }, { status: 400 });
  }

  const apiKey = request.headers.get('x-daytona-api-key')?.trim() || '';
  const apiUrl = request.headers.get('x-daytona-api-url')?.trim() || '';
  const githubToken = request.headers.get('x-github-token')?.trim() || process.env.GITHUB_TOKEN?.trim() || '';

  try {
    const result = await handleDaytonaAction({
      action: body?.action,
      body,
      apiKey,
      apiUrl,
      githubToken,
      signal: request.signal,
    });
    return Response.json(result.payload, { status: result.status });
  } catch (err) {
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : 'Daytona Sandbox error' },
      { status: 500 }
    );
  }
}
