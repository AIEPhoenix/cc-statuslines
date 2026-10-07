import type { RenderContext, PromptCacheData } from '../types.ts';
import { green, dim, label, warning, RESET } from './colors.ts';

// Under this much remaining TTL the next request may well rebuild the cache;
// the dot turns amber so a pause can be timed around it.
const EXPIRING_SOON_MS = 5 * 60_000;

/**
 * `Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)`
 * Prompt-cache health from stdin `prompt_cache` (CC ≥2.1.251). The engine omits
 * the block before the first response, so the line simply stays absent then.
 */
export function renderCacheLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCache === false) return null;
  const pc = ctx.stdin.prompt_cache;
  if (!pc || typeof pc !== 'object') return null;
  const colors = ctx.config?.colors;
  const now = Date.now();
  const state = cacheState(pc, now);

  const dot = state === 'warm' ? green('●') : state === 'expiring' ? warning('●', colors) : state === 'cold' ? warning('○', colors) : dim('○');
  const parts: string[] = [];

  if (state === 'unobserved') {
    parts.push(dim('not observed'));
  } else if (state === 'cold') {
    parts.push(warning('cold', colors));
    if (typeof pc.recache_tokens_if_cold === 'number' && pc.recache_tokens_if_cold > 0) parts.push(dim(`recache ${fmtTokens(pc.recache_tokens_if_cold)}`));
  } else {
    if (pc.ttl) parts.push(pc.ttl);
    const left = remainingMs(pc, now);
    if (left !== null) parts.push(`${dim('expires ')}${state === 'expiring' ? warning(fmtRemaining(left), colors) : fmtRemaining(left)}`);
  }

  if (typeof pc.hit_ratio === 'number' && Number.isFinite(pc.hit_ratio)) {
    parts.push(`${dim('hit ')}${Math.round(pc.hit_ratio * 100)}%`);
  }

  const miss = fmtMisses(pc);
  if (miss) parts.push(miss);

  return `${label('Cache', colors)} ${dot} ${parts.join(dim(' · '))}${RESET}`;
}

/** Short form for the compact layout: `cache ●42m 93%` / `cache ○cold`. */
export function renderCachePart(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCache === false) return null;
  const pc = ctx.stdin.prompt_cache;
  if (!pc || typeof pc !== 'object') return null;
  const colors = ctx.config?.colors;
  const now = Date.now();
  const state = cacheState(pc, now);
  if (state === 'unobserved') return null;
  const hit = typeof pc.hit_ratio === 'number' && Number.isFinite(pc.hit_ratio) ? ` ${Math.round(pc.hit_ratio * 100)}%` : '';
  if (state === 'cold') return `${dim('cache')} ${warning('○cold', colors)}${hit}`;
  const left = remainingMs(pc, now);
  const ttl = left !== null ? fmtRemaining(left) : (pc.ttl ?? '');
  const dot = state === 'expiring' ? warning(`●${ttl}`, colors) : green(`●${ttl}`);
  return `${dim('cache')} ${dot}${hit}`;
}

type CacheState = 'warm' | 'expiring' | 'cold' | 'unobserved';

function cacheState(pc: PromptCacheData, now: number): CacheState {
  if (pc.caching_observed === false) return 'unobserved';
  if (pc.warm !== true) return 'cold';
  const left = remainingMs(pc, now);
  if (left !== null && left <= EXPIRING_SOON_MS) return 'expiring';
  return 'warm';
}

function remainingMs(pc: PromptCacheData, now: number): number | null {
  if (typeof pc.expires_at !== 'number' || !Number.isFinite(pc.expires_at)) return null;
  return Math.max(0, pc.expires_at * 1000 - now);
}

/** `miss 2/14 (tools_changed +2 tools)`; null when nothing has missed yet. */
function fmtMisses(pc: PromptCacheData): string | null {
  const misses = typeof pc.misses === 'number' ? pc.misses : 0;
  if (misses <= 0) return null;
  const requests = typeof pc.requests === 'number' && pc.requests > 0 ? `/${pc.requests}` : '';
  const cause = pc.last_miss_cause;
  const causes = Array.isArray(cause?.causes) ? cause!.causes.filter(c => typeof c === 'string') : [];
  const detail: string[] = [];
  if (causes.length > 0) detail.push(causes.join('+'));
  if (typeof cause?.tools_added === 'number' && cause.tools_added > 0) detail.push(`+${cause.tools_added} tools`);
  if (typeof cause?.tools_removed === 'number' && cause.tools_removed > 0) detail.push(`-${cause.tools_removed} tools`);
  const why = detail.length > 0 ? dim(` (${detail.join(' ')})`) : '';
  return `${dim('miss ')}${misses}${dim(requests)}${why}`;
}

function fmtRemaining(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return n.toString();
}
