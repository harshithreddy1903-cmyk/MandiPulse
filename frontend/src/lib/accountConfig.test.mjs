import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAccountConfig} from './accountConfig.js';

test('account configuration rejects empty values and copied template placeholders', () => {
  assert.equal(hasAccountConfig('', ''), false);
  assert.equal(hasAccountConfig('https://your_project.supabase.co', 'your_publishable_key'), false);
  assert.equal(hasAccountConfig('https://project.supabase.co', 'replace_with_your_key'), false);
});

test('account configuration rejects invalid endpoints and permits configured hosted or local services', () => {
  assert.equal(hasAccountConfig('not-a-url', 'public-test-key'), false);
  assert.equal(hasAccountConfig('javascript:alert(1)', 'public-test-key'), false);
  assert.equal(hasAccountConfig('https://project.supabase.co', 'public-test-key'), true);
  assert.equal(hasAccountConfig('http://localhost:54321', 'public-test-key'), true);
});
