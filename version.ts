import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VERSION_REGEX = /\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?/;

let cachedVersion: string | undefined;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute - version won't change mid-session

export async function getClaudeCodeVersion(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedVersion && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVersion;
  }

  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      timeout: 2000,
      encoding: 'utf8',
    });
    const match = stdout.trim().match(VERSION_REGEX);
    if (match) {
      cachedVersion = match[0];
      cacheTimestamp = now;
    }
  } catch {
    // claude binary not found or timed out
  }

  return cachedVersion;
}
