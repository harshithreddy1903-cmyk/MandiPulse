import { createClient } from '@supabase/supabase-js';
import { hasAccountConfig } from './accountConfig.js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const previous = import.meta.hot?.data.accountClient;

// Reuse the account client across interface edits during local development.
export const db = hasAccountConfig(url, key)
  ? previous?.url === url && previous?.key === key && previous.client
    ? previous.client
    : createClient(url, key)
  : null;

if (import.meta.hot) {
  import.meta.hot.dispose(data => {
    data.accountClient = { url, key, client: db };
  });
}
