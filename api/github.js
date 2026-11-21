import { handleGitHubAction } from './_github.js';

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
  const token =
    request.headers.get('x-github-token')?.trim() || process.env.GITHUB_TOKEN?.trim() || '';
  try {
    const result = await handleGitHubAction({ action: body?.action, body, token });
    return Response.json(result.payload, { status: result.status });
  } catch (err) {
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : 'GitHub error' },
      { status: 500 }
    );
  }
}
