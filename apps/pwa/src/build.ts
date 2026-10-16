/**
 * The stamp of the build this app was compiled from.
 *
 * Vite replaces `__INKLING_BUILD__` with a literal at build time; the fallback keeps
 * `bun test` and a plain `tsc` happy, where nothing has been substituted.
 */
declare const __INKLING_BUILD__: string | undefined

export const APP_BUILD: string =
  typeof __INKLING_BUILD__ === 'string' && __INKLING_BUILD__.length > 0 ? __INKLING_BUILD__ : 'dev'
