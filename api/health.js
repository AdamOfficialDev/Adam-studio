export const config = {
  runtime: 'edge',
};

export default function handler() {
  const payload = {
    ok: true,
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-4-hydrogen',
    hasServerApiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
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
