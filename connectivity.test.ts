import { test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the hud dir (getHudDir() = CLAUDE_CONFIG_DIR/hud) so the cache/lock
// files land in a temp dir, never the real ~/.claude/hud.
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-conn-'));
process.env.CLAUDE_CONFIG_DIR = CFG;

const { parseTrace, performCheck, readConnectivity, scheduleRefresh, runRefresh, parseIpdataRisk, fetchIpdataRisk, lookupRisk, putRisk } = await import('./connectivity.ts');
const { renderConnectivityLine } = await import('./render/connectivity.ts');

const hudDir = path.join(CFG, 'hud');
const cacheFile = path.join(hudDir, 'connectivity.json');
const lockFile = path.join(hudDir, 'connectivity.lock');

beforeEach(() => {
  fs.rmSync(hudDir, { recursive: true, force: true });
  fs.mkdirSync(hudDir, { recursive: true });
  delete process.env.IPDATA_API_KEY; // keep the "no key" case deterministic
});
afterAll(() => { try { fs.rmSync(CFG, { recursive: true, force: true }); } catch {} });

const TRACE = `fl=123abc
h=api.anthropic.com
ip=203.0.113.7
ts=1720000000.5
visit_scheme=https
uag=claude-hud
colo=SJC
http=http/2
loc=US
warp=off`;

// ---- parsing ----

test('parseTrace extracts key=value lines including ip/loc/colo', () => {
  const t = parseTrace(TRACE);
  expect(t.ip).toBe('203.0.113.7');
  expect(t.loc).toBe('US');
  expect(t.colo).toBe('SJC');
  expect(t.h).toBe('api.anthropic.com');
});

test('parseTrace ignores blank and malformed lines', () => {
  const t = parseTrace('\nip=1.1.1.1\ngarbage\n=novalue\nloc=DE\n');
  expect(t.ip).toBe('1.1.1.1');
  expect(t.loc).toBe('DE');
  expect(Object.keys(t)).not.toContain('');
});

// ---- performCheck (fetch stubbed) ----

const withFetch = async <T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> => {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = orig; }
};

test('performCheck returns ok with ip/loc/colo on success', async () => {
  const info = await withFetch(
    (async () => new Response(TRACE, { status: 200 })) as unknown as typeof fetch,
    () => performCheck('https://x/trace', null),
  );
  expect(info.ok).toBe(true);
  expect(info.ip).toBe('203.0.113.7');
  expect(info.loc).toBe('US');
  expect(info.colo).toBe('SJC');
  expect(typeof info.ts).toBe('number');
});

test('performCheck fails closed and carries prior ip forward', async () => {
  const prev = { ok: true, ip: '203.0.113.7', loc: 'US', ts: 1 };
  const info = await withFetch(
    (() => { throw new Error('offline'); }) as unknown as typeof fetch,
    () => performCheck('https://x/trace', prev),
  );
  expect(info.ok).toBe(false);
  expect(info.ip).toBe('203.0.113.7'); // preserved for a "(offline)" display
  expect(info.loc).toBe('US');
});

test('performCheck treats a non-2xx / ip-less body as not ok', async () => {
  const info = await withFetch(
    (async () => new Response('error', { status: 503 })) as unknown as typeof fetch,
    () => performCheck('https://x/trace', null),
  );
  expect(info.ok).toBe(false);
  expect(info.ip).toBeUndefined();
});

// ---- cache round-trip via runRefresh ----

test('runRefresh writes a cache readConnectivity can read', async () => {
  await withFetch(
    (async () => new Response(TRACE, { status: 200 })) as unknown as typeof fetch,
    () => runRefresh(),
  );
  const c = readConnectivity();
  expect(c?.ok).toBe(true);
  expect(c?.ip).toBe('203.0.113.7');
  expect(fs.existsSync(lockFile)).toBe(false); // lock released
});

// ---- scheduleRefresh gate ----

test('scheduleRefresh spawns when there is no cache', () => {
  let spawned = 0;
  scheduleRefresh(() => { spawned++; });
  expect(spawned).toBe(1);
  expect(fs.existsSync(lockFile)).toBe(true); // lock taken
});

test('scheduleRefresh does not spawn when cache is fresh', () => {
  fs.writeFileSync(cacheFile, JSON.stringify({ ok: true, ip: '1.1.1.1', ts: Date.now() }));
  let spawned = 0;
  scheduleRefresh(() => { spawned++; });
  expect(spawned).toBe(0);
});

test('scheduleRefresh does not spawn when a fresh lock is held', () => {
  fs.writeFileSync(lockFile, '999'); // fresh lock = refresh in flight
  let spawned = 0;
  scheduleRefresh(() => { spawned++; });
  expect(spawned).toBe(0);
});

test('scheduleRefresh spawns when the lock is stale', () => {
  fs.writeFileSync(lockFile, '999');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, old, old); // lock older than LOCK_TTL_MS
  let spawned = 0;
  scheduleRefresh(() => { spawned++; });
  expect(spawned).toBe(1);
});

// ---- render ----

const ctxWith = (connectivity: unknown, show = true): any => ({
  config: { display: { showConnectivity: show }, colors: {} },
  connectivity,
});

test('renderConnectivityLine is silent when disabled or uncached', () => {
  expect(renderConnectivityLine(ctxWith(null, false))).toBeNull();
  expect(renderConnectivityLine(ctxWith(null, true))).toBeNull();
});

test('renderConnectivityLine shows ip · loc · colo when ok', () => {
  const out = renderConnectivityLine(ctxWith({ ok: true, ip: '203.0.113.7', loc: 'US', colo: 'SJC', ts: Date.now() }))!;
  expect(out).toContain('203.0.113.7');
  expect(out).toContain('US');
  expect(out).toContain('SJC');
  expect(out).toContain('Net');
});

test('renderConnectivityLine shows offline with no ip', () => {
  const out = renderConnectivityLine(ctxWith({ ok: false, ts: Date.now() }))!;
  expect(out).toContain('offline');
});

test('renderConnectivityLine flags a preserved-but-offline value', () => {
  const out = renderConnectivityLine(ctxWith({ ok: false, ip: '203.0.113.7', loc: 'US', ts: Date.now() }))!;
  expect(out).toContain('203.0.113.7');
  expect(out).toContain('(offline)');
});

// ---- IP risk (ipdata.co) ----

const riskCacheFile = path.join(hudDir, 'ip-risk-cache.json');
// Mirrors the real free-tier ipdata shape: country_code + threat booleans +
// blocklists, but NO `scores` / `is_vpn` (those are paid-tier only, verified live).
const IPDATA_JSON = { country_code: 'US', threat: { is_tor: false, is_proxy: true, is_datacenter: true, is_anonymous: true, is_known_abuser: false, is_known_attacker: false, is_threat: false, is_bogon: false, blocklists: [] } };

test('parseIpdataRisk maps threat fields, blocklists, country; abuser = abuser||attacker', () => {
  expect(parseIpdataRisk(IPDATA_JSON)).toEqual({ tor: false, vpn: false, proxy: true, datacenter: true, abuser: false, anon: true, threat: false, loc: 'US' });
  // a flagged ip on 2 blocklists; is_known_attacker sets abuser, is_threat composite
  expect(parseIpdataRisk({ country_code: 'RU', threat: { is_known_attacker: true, is_known_abuser: true, is_threat: true, blocklists: [{ name: 'Spamhaus' }, { name: 'X' }] } }))
    .toEqual({ tor: false, vpn: false, proxy: false, datacenter: false, abuser: true, anon: false, threat: true, blocklists: 2, loc: 'RU' });
  // paid tier: threat_score present under threat.scores
  expect(parseIpdataRisk({ threat: { is_proxy: true, scores: { threat_score: 88 } } }))
    .toEqual({ tor: false, vpn: false, proxy: true, datacenter: false, abuser: false, anon: false, threat: false, score: 88 });
  expect(parseIpdataRisk(null)).toEqual({ tor: false, vpn: false, proxy: false, datacenter: false, abuser: false, anon: false, threat: false });
});

test('fetchIpdataRisk builds /<ip>?api-key=…&fields=country_code,threat and parses', async () => {
  let seen = '';
  const r = await withFetch(
    (async (u: string) => { seen = u; return new Response(JSON.stringify(IPDATA_JSON), { status: 200 }); }) as unknown as typeof fetch,
    () => fetchIpdataRisk('https://api.ipdata.co', 'KEY123', '203.0.113.7'),
  );
  expect(seen).toBe('https://api.ipdata.co/203.0.113.7?api-key=KEY123&fields=country_code,threat');
  expect(r?.proxy).toBe(true);
  expect(r?.datacenter).toBe(true);
  expect(r?.loc).toBe('US');
});

test('fetchIpdataRisk returns null on non-2xx and on throw', async () => {
  expect(await withFetch((async () => new Response('nope', { status: 403 })) as unknown as typeof fetch, () => fetchIpdataRisk('https://api.ipdata.co', 'K', '1.2.3.4'))).toBeNull();
  expect(await withFetch((() => { throw new Error('x'); }) as unknown as typeof fetch, () => fetchIpdataRisk('https://api.ipdata.co', 'K', '1.2.3.4'))).toBeNull();
});

// ---- ip→risk map cache ----

test('putRisk/lookupRisk round-trip; expired entries miss and are pruned', () => {
  putRisk('1.1.1.1', { tor: false, vpn: false, proxy: true, datacenter: false, abuser: false, anon: true, threat: false });
  expect(lookupRisk('1.1.1.1')?.risk.proxy).toBe(true);
  expect(lookupRisk('9.9.9.9')).toBeNull();

  // Hand-write an expired entry, then a fresh put should prune it.
  const old = Date.now() - 25 * 60 * 60_000;
  fs.writeFileSync(riskCacheFile, JSON.stringify({ '2.2.2.2': { risk: {}, ts: old } }));
  expect(lookupRisk('2.2.2.2')).toBeNull(); // expired → miss
  putRisk('3.3.3.3', { tor: false, vpn: false, proxy: false, datacenter: false, abuser: false, anon: false, threat: false });
  expect(JSON.parse(fs.readFileSync(riskCacheFile, 'utf8'))['2.2.2.2']).toBeUndefined(); // pruned
});

// runRefresh risk needs connectivity on + an ipdata key.
const enableRiskConfig = () => fs.writeFileSync(path.join(hudDir, 'config.json'), JSON.stringify({ display: { showConnectivity: true, ipdataApiKey: 'KEY123' } }));

test('runRefresh queries ipdata for an unseen ip and caches it in the map', async () => {
  enableRiskConfig();
  let riskCalls = 0;
  await withFetch(
    (async (u: string) => {
      if (u.includes('ipdata.co')) { riskCalls++; return new Response(JSON.stringify(IPDATA_JSON), { status: 200 }); }
      return new Response(TRACE, { status: 200 }); // trace → ip 203.0.113.7
    }) as unknown as typeof fetch,
    () => runRefresh(),
  );
  expect(riskCalls).toBe(1);
  expect(readConnectivity()?.risk?.proxy).toBe(true);
  expect(readConnectivity()?.riskIp).toBe('203.0.113.7');
  expect(lookupRisk('203.0.113.7')?.risk.proxy).toBe(true); // persisted to the map
});

test('runRefresh serves a cached ip from the map without hitting ipdata', async () => {
  enableRiskConfig();
  putRisk('203.0.113.7', { tor: false, vpn: false, proxy: true, datacenter: true, abuser: false, anon: true, threat: false });
  let riskCalls = 0;
  await withFetch(
    (async (u: string) => {
      if (u.includes('ipdata.co')) { riskCalls++; return new Response(JSON.stringify(IPDATA_JSON), { status: 200 }); }
      return new Response(TRACE, { status: 200 }); // same ip 203.0.113.7
    }) as unknown as typeof fetch,
    () => runRefresh(),
  );
  expect(riskCalls).toBe(0); // served from the day-long map
  expect(readConnectivity()?.risk?.proxy).toBe(true);
});

test('runRefresh carries the last risk forward for the same ip when offline', async () => {
  enableRiskConfig();
  // Prior cache: ip 203.0.113.7 with a known reputation; map is empty (expired).
  fs.writeFileSync(cacheFile, JSON.stringify({
    ok: true, ip: '203.0.113.7', loc: 'US', ts: 1,
    risk: RISK({ proxy: true, blocklists: 2 }), riskIp: '203.0.113.7', riskTs: 1,
  }));
  let riskCalls = 0;
  await withFetch(
    (async (u: string) => {
      if (u.includes('ipdata.co')) { riskCalls++; return new Response(JSON.stringify(IPDATA_JSON), { status: 200 }); }
      throw new Error('offline'); // trace fetch fails → info.ok false, ip carried forward
    }) as unknown as typeof fetch,
    () => runRefresh(),
  );
  expect(riskCalls).toBe(0); // never hit ipdata while offline
  const c = readConnectivity();
  expect(c?.ok).toBe(false);
  expect(c?.risk?.proxy).toBe(true); // reputation preserved, badge won't flicker
});

test('runRefresh skips risk entirely when no ipdata key is configured', async () => {
  fs.writeFileSync(path.join(hudDir, 'config.json'), JSON.stringify({ display: { showConnectivity: true, ipdataApiKey: '' } }));
  let riskCalls = 0;
  await withFetch(
    (async (u: string) => {
      if (u.includes('ipdata.co')) { riskCalls++; return new Response(JSON.stringify(IPDATA_JSON), { status: 200 }); }
      return new Response(TRACE, { status: 200 });
    }) as unknown as typeof fetch,
    () => runRefresh(),
  );
  expect(riskCalls).toBe(0);
  expect(readConnectivity()?.risk).toBeUndefined();
});

// ---- render ----

const RISK = (over: Record<string, unknown> = {}): any => ({ tor: false, vpn: false, proxy: false, datacenter: false, abuser: false, anon: false, threat: false, ...over });
const mkCtx = (risk: any, key = 'K', loc = 'US'): any => ({ config: { display: { showConnectivity: true, ipdataApiKey: key }, colors: {} }, connectivity: { ok: true, ip: '1.2.3.4', loc, ts: Date.now(), risk } });

test('renderConnectivityLine shows the badge only when an ipdata key is set', () => {
  expect(renderConnectivityLine(mkCtx(RISK({ proxy: true })))).toContain('proxy');
  expect(renderConnectivityLine(mkCtx(RISK({ proxy: true }), ''))).not.toContain('proxy');
});

test('renderConnectivityLine shows top-severity flags, severity number, and clean', () => {
  expect(renderConnectivityLine(mkCtx(RISK({ tor: true, datacenter: true })))).toContain('TOR'); // tor outranks DC
  expect(renderConnectivityLine(mkCtx(RISK({ proxy: true, score: 40 })))).toContain('40'); // paid-tier score
  expect(renderConnectivityLine(mkCtx(RISK({ abuser: true, blocklists: 2 })))).toContain('2bl'); // free-tier blocklist count
  expect(renderConnectivityLine(mkCtx(RISK()))).toContain('clean');
});

test('renderConnectivityLine never reads a blocklisted ip as clean, even with no boolean flag', () => {
  const out = renderConnectivityLine(mkCtx(RISK({ blocklists: 3 }))); // on 3 blocklists, no tor/proxy/etc set
  expect(out).toContain('3bl');
  expect(out).not.toContain('clean');
});

test('renderConnectivityLine colors the badge red when ipdata flags a threat', () => {
  const RED = '\x1b[38;5;167m';
  expect(renderConnectivityLine(mkCtx(RISK({ proxy: true, threat: true, score: 100 })))).toContain(RED);
});

test('renderConnectivityLine warns on a CF/ipdata geo mismatch (and not when they agree)', () => {
  // CF loc = US, ipdata country = JP → mismatch
  expect(renderConnectivityLine(mkCtx(RISK({ loc: 'JP' }), 'K', 'US'))).toContain('geo US≠JP');
  // agree → no geo warning
  expect(renderConnectivityLine(mkCtx(RISK({ loc: 'US' }), 'K', 'US'))).not.toContain('geo');
  // no ipdata loc → no warning
  expect(renderConnectivityLine(mkCtx(RISK(), 'K', 'US'))).not.toContain('geo');
});
