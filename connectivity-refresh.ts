// Standalone detached process spawned by the statusline when the connectivity
// cache is stale. Fetches the trace endpoint, writes the cache, releases the
// lock, and exits — fully decoupled from the render process so rendering never
// blocks on the network.
import { runRefresh } from './connectivity.ts';

await runRefresh();
