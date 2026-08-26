import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cfgtest-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const hudDir = path.join(CFG, 'hud');

const { loadConfig } = await import('./config.ts');

beforeEach(() => {
  fs.rmSync(hudDir, { recursive: true, force: true });
  fs.mkdirSync(hudDir, { recursive: true });
  delete process.env.IPDATA_API_KEY;
});
afterEach(() => { delete process.env.IPDATA_API_KEY; });

const writeBase = (o: object) => fs.writeFileSync(path.join(hudDir, 'config.json'), JSON.stringify(o));
const writeLocal = (o: object) => fs.writeFileSync(path.join(hudDir, 'config.local.json'), JSON.stringify(o));

test('config.local.json overrides config.json per display key', async () => {
  writeBase({ display: { showConnectivity: true, ipdataApiKey: '' } });
  writeLocal({ display: { ipdataApiKey: 'SECRET' } });
  const cfg = await loadConfig();
  expect(cfg.display.ipdataApiKey).toBe('SECRET');
  expect(cfg.display.showConnectivity).toBe(true); // base key preserved through the merge
});

test('IPDATA_API_KEY env is used when no config key is set', async () => {
  writeBase({ display: { showConnectivity: true } });
  process.env.IPDATA_API_KEY = 'FROM_ENV';
  expect((await loadConfig()).display.ipdataApiKey).toBe('FROM_ENV');
});

test('a configured key beats the env fallback', async () => {
  writeBase({ display: { ipdataApiKey: 'FROM_FILE' } });
  process.env.IPDATA_API_KEY = 'FROM_ENV';
  expect((await loadConfig()).display.ipdataApiKey).toBe('FROM_FILE');
});

test('no key anywhere → empty (risk stays off)', async () => {
  writeBase({ display: { showConnectivity: true } });
  expect((await loadConfig()).display.ipdataApiKey).toBe('');
});
