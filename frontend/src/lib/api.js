export function resolveApiBaseUrl(configured, development = false) {
  const base = String(configured || '').trim().replace(/\/+$/, '');
  if (!base) return development ? 'http://127.0.0.1:8000' : '';
  if (!development) {
    try {
      const { hostname } = new URL(base, 'https://same-origin.invalid');
      if (hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname)
        || ['0.0.0.0', '[::1]', '[::]'].includes(hostname)) return '';
    } catch { /* Keep explicit endpoint validation with the existing fetch error handling. */ }
  }
  return base;
}

export function responseError(detail, fallback) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) return detail.map(item => item.msg || 'Check the entered values.').join(' ');
  return fallback;
}

export async function fetchJson(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error('The service returned an unreadable response. Please try again.'), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(responseError(data?.detail, 'The request could not be completed. Please try again.')), { status: response.status });
    return data;
  } catch (error) {
    if (timedOut) throw new Error('This is taking longer than expected. Please try again.');
    if (error.name === 'AbortError') throw error;
    if (error instanceof TypeError) throw new Error('The service could not be reached. Please try again in a moment.');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
