import { createReaderApp } from './reader-http.mjs';
import { createLegacyReader } from './legacy-reader.mjs';
import { cardLifecycleEndpoint } from './card-lifecycle-http.mjs';

export { assetPath } from './reader-http.mjs';

// Preserve synchronous startup and validation for existing SiYuan and injected callers.
export function createApp(options) {
  if (!options.agentToken) throw new Error('Agent token is required');
  const legacy = options.contentReader ? undefined : createLegacyReader(options);
  return createReaderApp(options,{legacy,lifecycleEndpoint:options.lifecycle && cardLifecycleEndpoint});
}
