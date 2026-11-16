/**
 * Netlify scheduled function, once a day (UTC). Netlify Server stops when idle and runs the
 * background jobs only while it is up, so this request wakes it: within seconds it starts any
 * season whose date has arrived and removes expired sessions, even if nobody opens the app.
 * Those database queries also count as activity for Supabase, which pauses free projects
 * after 7 days without any.
 */
export default async (): Promise<void> => {
  const res = await fetch(new URL('/ready', process.env.URL), { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`The API is not ready: GET /ready answered ${res.status}`);
};

export const config = { schedule: '@daily' };
