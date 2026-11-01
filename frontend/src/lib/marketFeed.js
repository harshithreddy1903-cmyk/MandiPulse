export const EMPTY_MARKET_MESSAGE = 'The official provider has no usable Karnataka price records available right now. Please try again later.';

export function planningCropOptions(market) {
  const names = values => [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const catalog = names(market.commodity_catalog);
  return { commodities: catalog.length ? catalog : names(market.commodities), fromCatalog: catalog.length > 0 };
}

export function cachedMarketMessage(market) {
  const warning = market.warning || market.message || 'Only dated official price records are available.';
  const retrieved = market.last_retrieved_at ? new Date(market.last_retrieved_at) : null;
  const retrievedLabel = retrieved && !Number.isNaN(retrieved.getTime())
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(retrieved)
    : market.last_retrieved_at;
  return [warning, 'These are not live prices. Check each record\'s price date and confirm current availability.',
    retrievedLabel && `Last retrieved: ${retrievedLabel}.`].filter(Boolean).join(' ');
}

// This helper is only used for the statewide market-feed request. Other API
// endpoints can use 404 for different reasons and keep their own error handling.
export function marketFeedFailure(current, error) {
  if (error?.status === 404) {
    return { ...current, mode: 'empty', records: [], commodities: [], analytics: null, updated_at: null };
  }
  return { ...current, mode: 'unavailable' };
}
