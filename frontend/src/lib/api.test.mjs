import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, resolveApiBaseUrl } from './api.js';
import { EMPTY_MARKET_MESSAGE, cachedMarketMessage, marketFeedFailure, planningCropOptions } from './marketFeed.js';

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const waitForAbort = (_url, { signal }) => new Promise((_resolve, reject) => {
  const aborted = () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
  if (signal.aborted) aborted();
  else signal.addEventListener('abort', aborted, { once: true });
});

test('API defaults use same origin in production and port 8000 in local development', () => {
  assert.equal(resolveApiBaseUrl(undefined), '');
  assert.equal(resolveApiBaseUrl('  ', false), '');
  assert.equal(resolveApiBaseUrl(undefined, true), 'http://127.0.0.1:8000');
});

test('production ignores local API addresses left in development settings', () => {
  for (const base of ['http://127.0.0.1:8000', 'http://localhost:8000/', 'http://127.1:8000',
    'http://0.0.0.0:8000', 'http://[::1]:8000', '//localhost:8000', 'http://api.localhost:8000']) {
    assert.equal(resolveApiBaseUrl(base, false), '', `Production API must not point at ${base}`);
  }
});

test('API endpoint overrides preserve remote and relative deployments and local development', () => {
  assert.equal(resolveApiBaseUrl(' https://api.example.org/base/// ', false), 'https://api.example.org/base');
  assert.equal(resolveApiBaseUrl('/backend/', false), '/backend');
  assert.equal(resolveApiBaseUrl('http://127.0.0.1:8000/', true), 'http://127.0.0.1:8000');
});

test('fetchJson returns successful data unchanged, including an empty 200 response', async t => {
  const data = { mode: 'live', records: [] };
  t.mock.method(globalThis, 'fetch', async () => jsonResponse(data));
  assert.deepEqual(await fetchJson('/test'), data);
});

test('fetchJson preserves feed 404 status and its plain error detail', async t => {
  const detail = 'No usable Karnataka price records were returned by the feed.';
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({ detail }, 404));
  await assert.rejects(fetchJson('/test'), error => {
    assert.equal(error.status, 404); assert.equal(error.message, detail); return true;
  });
});

test('fetchJson preserves other HTTP statuses and existing validation messages', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const [status, data, message] of [
    [401, null, 'The request could not be completed. Please try again.'],
    [422, { detail: [{ msg: 'Choose a crop.' }, { msg: 'Enter a weight.' }] }, 'Choose a crop. Enter a weight.'],
    [503, { detail: 'The provider is unavailable.' }, 'The provider is unavailable.'],
  ]) {
    response = jsonResponse(data, status);
    await assert.rejects(fetchJson('/test'), error => {
      assert.equal(error.status, status); assert.equal(error.message, message); return true;
    });
  }
});

test('fetchJson keeps the unreadable-response message and HTTP status for invalid JSON', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not JSON', { status: 502 }));
  await assert.rejects(fetchJson('/test'), error => {
    assert.equal(error.status, 502);
    assert.equal(error.message, 'The service returned an unreadable response. Please try again.'); return true;
  });
});

test('fetchJson keeps network failures distinct from HTTP errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(fetchJson('/test'), error => {
    assert.equal(error.status, undefined);
    assert.equal(error.message, 'The service could not be reached. Please try again in a moment.'); return true;
  });
});

test('fetchJson preserves caller cancellation before and during a request', async t => {
  t.mock.method(globalThis, 'fetch', waitForAbort);
  const before = new AbortController(); before.abort();
  await assert.rejects(fetchJson('/test', { signal: before.signal }), { name: 'AbortError' });
  const during = new AbortController();
  const pending = fetchJson('/test', { signal: during.signal }); during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('fetchJson preserves the timeout message rather than reporting no records', async t => {
  t.mock.method(globalThis, 'fetch', waitForAbort);
  await assert.rejects(fetchJson('/test', {}, 5), error => {
    assert.equal(error.status, undefined);
    assert.equal(error.message, 'This is taking longer than expected. Please try again.'); return true;
  });
});

test('only a statewide feed 404 becomes empty and clears stale records and analytics', () => {
  const current = { mode: 'live', records: [{ commodity: 'Tomato' }], commodities: ['Tomato'], analytics: { total: 1 }, updated_at: '2026-10-30' };
  const empty = marketFeedFailure(current, { status: 404 });
  assert.equal(empty.mode, 'empty'); assert.deepEqual(empty.records, []);
  assert.deepEqual(empty.commodities, []); assert.equal(empty.analytics, null); assert.equal(empty.updated_at, null);
  assert.match(EMPTY_MARKET_MESSAGE, /provider has no usable Karnataka price records/);
  assert.match(EMPTY_MARKET_MESSAGE, /try again later/i);
  for (const status of [undefined, 0, 200, 401, 429, 500, 503]) {
    const failed = marketFeedFailure(current, { status });
    assert.equal(failed.mode, 'unavailable'); assert.equal(failed.records, current.records);
    assert.equal(failed.analytics, current.analytics); assert.equal(failed.updated_at, current.updated_at);
  }
});

test('cached records retain provider coverage warnings, non-live wording and retrieval time', () => {
  const market = { mode: 'cached', stale: true, warning: 'Official weekly records from 29/10/2026; partial market coverage.',
    last_retrieved_at: '2026-10-31T12:00:00Z', records: [{ commodity: 'Tomato', arrival_date: '29/10/2026' }] };
  const message = cachedMarketMessage(market);
  assert.ok(message.includes(market.warning)); assert.match(message, /not live prices/);
  assert.match(message, /Check each record's price date/); assert.match(message, /Last retrieved:/);
  assert.equal(market.records[0].arrival_date, '29/10/2026');
  assert.match(cachedMarketMessage({ mode: 'cached' }), /Only dated official price records/);
  assert.match(cachedMarketMessage({ mode: 'cached', message: 'Stored official snapshot.', last_retrieved_at: 'Date unavailable' }), /Stored official snapshot.*Date unavailable/);
});

test('planning offers the full official catalog without changing actual price coverage', () => {
  const commodity_catalog = Array.from({ length: 609 }, (_, index) => `Official crop ${index + 1}`);
  const market = { commodity_catalog, commodities: ['Tomato', 'Onion', 'Potato', 'Cabbage', 'Carrot', 'Brinjal', 'Beans'] };
  const options = planningCropOptions(market);
  assert.equal(options.fromCatalog, true); assert.equal(options.commodities.length, 609);
  assert.ok(options.commodities.includes('Official crop 609'));
  assert.equal(market.commodities.length, 7); assert.equal(market.commodity_catalog, commodity_catalog);
});

test('planning falls back to priced crops when the catalog is absent or unusable', () => {
  for (const commodity_catalog of [undefined, [], [' ', null]]) {
    assert.deepEqual(planningCropOptions({ commodity_catalog, commodities: [' Tomato ', 'Onion', 'Tomato'] }), {
      commodities: ['Onion', 'Tomato'], fromCatalog: false,
    });
  }
  assert.deepEqual(planningCropOptions({ commodity_catalog: ['Bengal Gram Dal', ' Alasande Gram ', 'Bengal Gram Dal'], commodities: ['Tomato'] }), {
    commodities: ['Alasande Gram', 'Bengal Gram Dal'], fromCatalog: true,
  });
});
