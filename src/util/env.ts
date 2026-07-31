/**
 * Environment detection that works in both Vite and plain Node.
 *
 * `import.meta.env` is injected by Vite and simply does not exist when the same module is loaded by
 * Node — reading `.DEV` off it throws. That matters because the whole point of the headless
 * simulation is that `gameplay/`, `ai/`, `maps/` and `physics/` run unchanged on a dedicated
 * server, so any shared module reaching for a bundler-specific global breaks that guarantee.
 *
 * Client-only modules (anything under `render/` or `ui/`) may use `import.meta.env` directly.
 * Shared modules must come through here.
 */

const viteEnv = (): { DEV?: boolean; PROD?: boolean } | undefined => {
  try {
    return (import.meta as unknown as { env?: { DEV?: boolean; PROD?: boolean } }).env;
  } catch {
    return undefined;
  }
};

const nodeEnv = (): string | undefined => {
  try {
    return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  } catch {
    return undefined;
  }
};

/** True in development. Defaults to true when neither environment declares itself. */
export const isDev = (): boolean => {
  const vite = viteEnv();
  if (vite?.DEV !== undefined) return vite.DEV;
  const node = nodeEnv();
  if (node !== undefined) return node !== 'production';
  return true;
};

/** True when running under Node rather than a browser — used to skip DOM-only paths. */
export const isServer = (): boolean =>
  typeof window === 'undefined' && typeof (globalThis as { process?: unknown }).process === 'object';
