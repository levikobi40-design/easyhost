/**
 * Automation / Claude API helper — timeouts + Anthropic Messages API (2023-06-01).
 * Use when the dashboard needs a direct client-side call (prefer server proxy in production).
 */

const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Fetch with AbortController timeout (prevents hanging UI).
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * POST https://api.anthropic.com/v1/messages — Claude 3.5+ compatible headers.
 * @param {{ apiKey: string, system?: string, messages: Array<{role:string,content:string}>, model?: string, maxTokens?: number }} opts
 */
export async function invokeAnthropicMessages({
  apiKey,
  system = '',
  messages,
  model = 'claude-sonnet-4-20250514',
  maxTokens = 1024,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const key = (
    apiKey ||
    process.env.REACT_APP_ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  ).trim();
  if (!key) {
    throw new Error(
      'Missing Anthropic API key — set REACT_APP_ANTHROPIC_API_KEY in .env for the React app (only REACT_APP_* is exposed to the browser), or pass apiKey.',
    );
  }
  const body = {
    model,
    max_tokens: maxTokens,
    messages: Array.isArray(messages) ? messages : [],
  };
  if (system && String(system).trim()) {
    body.system = String(system).trim();
  }
  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'Anthropic request failed';
    throw new Error(msg);
  }
  let text = '';
  if (Array.isArray(data?.content)) {
    text = data.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return { text, raw: data };
}
