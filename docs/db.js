import { config } from './config.js';

let clientPromise = null;

/** The Supabase client, or null when the site isn't connected to a database yet. */
export function getClient() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return Promise.resolve(null);
  clientPromise ??= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(({ createClient }) => createClient(config.supabaseUrl, config.supabaseAnonKey));
  return clientPromise;
}

export const degToKm = (deg) => (deg * config.routeKm) / 360;
export const fmtKm = (km) => km.toLocaleString('en-GB', { maximumFractionDigits: 1 });
