/**
 * lib/live/index.js — v12 public barrel
 * Facade over adapters + registry + pipeline. Keeps old imports working.
 */
export * from './registry.js';
export { deduplicateChannels, logicalIdForChannel, isDummyVariant } from './pipeline/deduplicate.js';
export { isExpiring, tokenFreshnessLabel, readHdneaExpiry } from './tokens/hdnea.js';
export { needsProxyForVariant, isGeoSensitive, policyForLogicalChannel } from './playback/policy.js';
export { fetchTextForSource } from './pipeline/fetch.js';

import { SOURCE_REGISTRY } from './registry.js';
import { fetchTextForSource } from './pipeline/fetch.js';
import { JioAdapter } from './adapters/jioAdapter.js';
import { HjhAdapter } from './adapters/hjhAdapter.js';
import { JashAdapter } from './adapters/jashAdapter.js';
import { PocketAdapter } from './adapters/pocketAdapter.js';
import { TamilIptvAdapter } from './adapters/tamilIptvAdapter.js';

const ADAPTERS = {
  jioAdapter: JioAdapter,
  hjhAdapter: HjhAdapter,
  jashAdapter: JashAdapter,
  pocketAdapter: PocketAdapter,
  tamilIptvAdapter: TamilIptvAdapter,
};

export async function fetchAndParseSource(sourceId) {
  const def = SOURCE_REGISTRY[sourceId] || null;
  if (!def) throw new Error(`Unknown source ${sourceId}`);
  const Cls = ADAPTERS[def.adapter];
  if (!Cls) throw new Error(`No adapter ${def.adapter}`);
  const adapter = new Cls(def);
  return adapter.fetchAndParse(fetchTextForSource);
}
