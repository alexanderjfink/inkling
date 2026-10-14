import type { BlipEvent } from './events'
import { sha256Hex } from './hash'
import { project } from './project'

/**
 * A digest of the folded state.
 *
 * Two devices that have seen the same events fold to the same projection, so equal
 * digests *prove* convergence. Unequal digests after a sync turn a silent divergence
 * into a visible one — which is the difference between trusting sync and hoping.
 */
export async function stateDigest(events: BlipEvent[]): Promise<string> {
  const canonical = JSON.stringify(project(events))
  return sha256Hex(new TextEncoder().encode(canonical))
}
