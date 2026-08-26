import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { getHudDir, loadConfig } from './config.ts';

export interface RiskFlags {
  tor: boolean;
  vpn: boolean;
  proxy: boolean;
  datacenter: boolean;
  /** is_known_abuser or is_known_attacker — a "dirty" reputation history. */
  abuser: boolean;
  /** is_anonymous — the anonymizer umbrella. */
  anon: boolean;
  /** is_threat — ipdata's composite bad-IP flag; drives the badge color. */
  threat: boolean;
  /** threat.scores.threat_score, 0–100 (higher = worse). Paid-tier only; absent
   * on the free key, in which case the badge falls back to the blocklist count. */
  score?: number;
  /** count of reputation blocklists the ip appears on (Spamhaus, etc.). */
  blocklists?: number;
  /** ipdata's country_code, cross-checked against the Cloudflare trace loc —
   * a mismatch flags a geo inconsistency (proxy/tunnel tell). */
  loc?: string;
}

export interface ConnectivityInfo {
  /** true = last fetch reached the endpoint and returned an ip. */
  ok: boolean;
  ip?: string;
  loc?: string;
  /** Cloudflare edge datacenter (e.g. "SJC") — where the request egressed. */
  colo?: string;
  /** ms epoch of the last attempt (success or failure). */
  ts: number;
  /** IP-reputation flags, and the ip/time they were computed for. Refreshed
   * only when the egress ip changes or the risk data ages out — NOT every
   * trace tick — so the rate-limited risk endpoint stays well within quota. */
  risk?: RiskFlags;
  riskIp?: string;
  riskTs?: number;
}

// Refresh at most once every 15s; a fetch in flight holds a lock for up to 30s.
const REFRESH_MS = 15_000;
const LOCK_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
// IP reputation changes slowly, so each ip's risk is cached for a full day in a
// local ip→risk map; only an unseen or expired ip costs an ipdata lookup.
const RISK_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_URL = 'https://api.anthropic.com/cdn-cgi/trace';
const DEFAULT_IPDATA_BASE = 'https://api.ipdata.co';

function cachePath(): string { return path.join(getHudDir(), 'connectivity.json'); }
function lockPath(): string { return path.join(getHudDir(), 'connectivity.lock'); }
function riskCachePath(): string { return path.join(getHudDir(), 'ip-risk-cache.json'); }

function readRaw(): ConnectivityInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (parsed && typeof parsed.ts === 'number') return parsed as ConnectivityInfo;
  } catch {}
  return null;
}

/** Write via a temp file + rename so a concurrent reader (the render process,
 * every ~300ms) never sees a half-written file — rename is atomic on one fs. */
function atomicWrite(p: string, data: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, p);
}

function writeRaw(info: ConnectivityInfo): void {
  try { atomicWrite(cachePath(), JSON.stringify(info)); } catch {}
}

/** The cached connectivity result for display, or null if never checked. */
export function readConnectivity(): ConnectivityInfo | null {
  return readRaw();
}

/** Parse a Cloudflare cdn-cgi/trace body (`key=value` lines) into a map. */
export function parseTrace(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Hit the trace endpoint once. On failure, carry the previous ip/loc forward
 * so the display can mark them stale rather than blanking out. Never throws. */
export async function performCheck(url: string, prev: ConnectivityInfo | null, timeoutMs = FETCH_TIMEOUT_MS): Promise<ConnectivityInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'claude-hud' } });
    const t = parseTrace(await res.text());
    if (res.ok && t.ip) return { ok: true, ip: t.ip, loc: t.loc, colo: t.colo, ts: Date.now() };
    return { ok: false, ip: prev?.ip, loc: prev?.loc, colo: prev?.colo, ts: Date.now() };
  } catch {
    return { ok: false, ip: prev?.ip, loc: prev?.loc, colo: prev?.colo, ts: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/** Map an ipdata response to the flags we display. The threat block may arrive
 * nested under `threat` or flattened at the top level; both are accepted. The
 * numeric `threat_score` (under threat.scores) and top-level `country_code` are
 * captured when present. Missing fields default to false/undefined. */
export function parseIpdataRisk(json: unknown): RiskFlags {
  const root = (json ?? {}) as Record<string, unknown>;
  const t = ((root.threat ?? root) ?? {}) as Record<string, unknown>;
  const scores = (t.scores ?? {}) as Record<string, unknown>;
  const score = scores.threat_score;
  const bl = Array.isArray(t.blocklists) ? t.blocklists.length : 0;
  const cc = root.country_code;
  return {
    tor: t.is_tor === true,
    vpn: t.is_vpn === true,
    proxy: t.is_proxy === true,
    datacenter: t.is_datacenter === true,
    abuser: t.is_known_abuser === true || t.is_known_attacker === true,
    anon: t.is_anonymous === true,
    threat: t.is_threat === true,
    ...(typeof score === 'number' && Number.isFinite(score) ? { score } : {}),
    ...(bl > 0 ? { blocklists: bl } : {}),
    ...(typeof cc === 'string' && cc ? { loc: cc } : {}),
  };
}

/** Query ipdata for a specific ip's country + threat block. null on any failure. */
export async function fetchIpdataRisk(baseUrl: string, apiKey: string, ip: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<RiskFlags | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = baseUrl.replace(/\/+$/, '');
    const url = `${base}/${encodeURIComponent(ip)}?api-key=${encodeURIComponent(apiKey)}&fields=country_code,threat`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'claude-hud' } });
    if (!res.ok) return null;
    return parseIpdataRisk(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- local ip→risk map cache (1-day TTL) ----

interface RiskCacheEntry { risk: RiskFlags; ts: number; }
type RiskCache = Record<string, RiskCacheEntry>;

function readRiskCache(): RiskCache {
  try {
    const j = JSON.parse(fs.readFileSync(riskCachePath(), 'utf8'));
    return j && typeof j === 'object' ? (j as RiskCache) : {};
  } catch { return {}; }
}

/** A cached, still-fresh reputation for `ip`, or null if unseen/expired. */
export function lookupRisk(ip: string): RiskCacheEntry | null {
  const e = readRiskCache()[ip];
  if (e && typeof e.ts === 'number' && Date.now() - e.ts < RISK_TTL_MS) return e;
  return null;
}

/** Store `ip`'s reputation and drop any entries that have aged out. */
export function putRisk(ip: string, risk: RiskFlags): void {
  try {
    const cache = readRiskCache();
    cache[ip] = { risk, ts: Date.now() };
    for (const k of Object.keys(cache)) {
      const e = cache[k];
      if (!e || typeof e.ts !== 'number' || Date.now() - e.ts >= RISK_TTL_MS) delete cache[k];
    }
    atomicWrite(riskCachePath(), JSON.stringify(cache));
  } catch {}
}

type Spawner = () => void;

function defaultSpawn(): void {
  const child = spawn(process.execPath, [path.join(import.meta.dir, 'connectivity-refresh.ts')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

/**
 * Non-blocking: if the cache is stale and no refresh is already in flight, take
 * the lock and spawn a detached refresher, then return immediately. The render
 * path never waits on the network — this frame shows the cached value and the
 * next frame picks up whatever the refresher wrote. Never throws.
 */
export function scheduleRefresh(spawner: Spawner = defaultSpawn): void {
  try {
    const cache = readRaw();
    if (cache && Date.now() - cache.ts < REFRESH_MS) return;

    const lock = lockPath();
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs < LOCK_TTL_MS) return; // refresh in flight
      fs.unlinkSync(lock); // stale lock from a dead refresher — clear it
    } catch {}

    // Exclusive create: if a racing statusline already claimed the lock, back off.
    try { fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
    catch { return; }

    // If the spawn itself fails, release the lock now rather than stranding it
    // until the 30s TTL sweep.
    try { spawner(); } catch { try { fs.unlinkSync(lock); } catch {} }
  } catch {}
}

/** Entry point for the detached refresher process (connectivity-refresh.ts). */
export async function runRefresh(): Promise<void> {
  let url = DEFAULT_URL;
  let ipdataBase = DEFAULT_IPDATA_BASE;
  let apiKey = '';
  let connOn = false;
  try {
    const cfg = await loadConfig();
    if (cfg.display.connectivityUrl) url = cfg.display.connectivityUrl;
    if (cfg.display.ipdataBaseUrl) ipdataBase = cfg.display.ipdataBaseUrl;
    apiKey = cfg.display.ipdataApiKey?.trim() ?? '';
    connOn = cfg.display.showConnectivity === true;
  } catch {}

  const prev = readRaw();
  const info = await performCheck(url, prev);

  // Risk requires connectivity on AND a configured ipdata key. Each ip's
  // reputation is served from the local day-long map; only an unseen or expired
  // ip costs one ipdata lookup. On lookup failure, carry the prior value if it
  // was for this same ip.
  if (connOn && apiKey && info.ip) {
    // Keep the last known reputation for the same ip when we can't refresh it.
    const carry = () => {
      if (prev?.risk && prev.riskIp === info.ip) { info.risk = prev.risk; info.riskIp = prev.riskIp; info.riskTs = prev.riskTs; }
    };
    const hit = lookupRisk(info.ip);
    if (hit) {
      info.risk = hit.risk; info.riskIp = info.ip; info.riskTs = hit.ts;
    } else if (info.ok) {
      const flags = await fetchIpdataRisk(ipdataBase, apiKey, info.ip);
      if (flags) {
        putRisk(info.ip, flags);
        info.risk = flags; info.riskIp = info.ip; info.riskTs = Date.now();
      } else carry(); // ipdata lookup failed
    } else carry(); // offline this tick
  }

  writeRaw(info);
  try { fs.unlinkSync(lockPath()); } catch {}
}
