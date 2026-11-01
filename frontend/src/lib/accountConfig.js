export function hasAccountConfig(url, key) {
  if (!url?.trim() || !key?.trim()) return false;
  if (/(your[_-]|replace[_-]|placeholder|example\.com)/i.test(url) || /^(your[_-]|replace[_-]|placeholder)/i.test(key.trim())) return false;
  try {
    const endpoint = new URL(url);
    return ['http:', 'https:'].includes(endpoint.protocol) && Boolean(endpoint.hostname);
  } catch { return false; }
}
