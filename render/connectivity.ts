import type { RenderContext } from '../types.ts';
import type { ConnectivityInfo } from '../connectivity.ts';
import { green, red, yellow, dim, label, RESET } from './colors.ts';

// A refresh older than this means the refresher likely died mid-flight; the
// value is shown but flagged stale so it isn't read as live.
const STALE_AFTER_MS = 5 * 60_000;

/** `Net ● 1.2.3.4 · US · SJC · ⚠ VPN` — connectivity + optional IP risk. */
export function renderConnectivityLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showConnectivity !== true) return null;
  const colors = ctx.config?.colors;
  const c = ctx.connectivity;
  // No cache yet (first frame after enabling): stay silent until the refresher lands.
  if (!c) return null;

  const stale = Date.now() - c.ts > STALE_AFTER_MS;

  if (!c.ok && !c.ip) {
    return `${label('Net', colors)} ${red('●')} ${dim('offline')}`;
  }

  const parts = [c.ip ?? '?', c.loc, c.colo].filter(Boolean) as string[];
  // Risk + geo-check show only when an ipdata key is configured (its presence
  // is the switch); without it the refresher never populates c.risk.
  const withRisk = !!ctx.config?.display?.ipdataApiKey;
  const extras = [withRisk ? riskBadge(c) : null, withRisk ? geoMismatch(c) : null].filter(Boolean) as string[];
  const body = [parts.join(dim(' · ')), ...extras].join(dim(' · '));
  const dot = c.ok && !stale ? green('●') : yellow('●');
  const suffix = !c.ok ? dim(' (offline)') : stale ? dim(' (stale)') : '';
  return `${label('Net', colors)} ${dot} ${body}${suffix}${RESET}`;
}

// Most-severe-first: the badge shows the top two hits, so a Tor exit reads as
// "TOR" rather than burying it behind less-specific flags.
const RISK_LABELS: Array<[keyof NonNullable<ConnectivityInfo['risk']>, string]> = [
  ['tor', 'TOR'], ['vpn', 'VPN'], ['proxy', 'proxy'], ['abuser', 'abuse'], ['datacenter', 'DC'], ['anon', 'anon'],
];

/** `⚠ proxy+abuse 100` when flagged (red if ipdata calls it a threat, else
 * yellow). The trailing severity is threat_score when the tier provides it,
 * otherwise the blocklist count as `Nbl`. Dim `clean` when checked-and-clean. */
function riskBadge(c: ConnectivityInfo): string | null {
  const r = c.risk;
  if (!r) return null;
  const hit = RISK_LABELS.filter(([k]) => r[k]).map(([, lbl]) => lbl);
  const sev = typeof r.score === 'number' ? ` ${r.score}`
    : (typeof r.blocklists === 'number' && r.blocklists > 0 ? ` ${r.blocklists}bl` : '');
  if (hit.length === 0) {
    // A nonzero score or blocklist hit is itself a signal even with no boolean
    // flag set — an IP on Spamhaus must never read as "clean".
    if (typeof r.score === 'number' && r.score > 0) return (r.threat ? red : yellow)(`⚠ risk ${r.score}`);
    if (typeof r.blocklists === 'number' && r.blocklists > 0) return (r.threat ? red : yellow)(`⚠ ${r.blocklists}bl`);
    return dim('clean');
  }
  const text = `⚠ ${hit.slice(0, 2).join('+')}${sev}`;
  return r.threat ? red(text) : yellow(text);
}

/** `⚠ geo US≠JP` when ipdata's country disagrees with the Cloudflare loc —
 * a common proxy/tunnel tell. null when either side is missing or they agree. */
function geoMismatch(c: ConnectivityInfo): string | null {
  const cf = c.loc, ip = c.risk?.loc;
  if (!cf || !ip || cf.toUpperCase() === ip.toUpperCase()) return null;
  return yellow(`⚠ geo ${cf}≠${ip}`);
}
