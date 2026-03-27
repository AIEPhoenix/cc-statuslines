import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getClaudeConfigDir } from './config.ts';

export interface ConfigCounts {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
}

function getMcpServerNames(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (config.mcpServers && typeof config.mcpServers === 'object') return new Set(Object.keys(config.mcpServers));
  } catch {}
  return new Set();
}

function getDisabledMcpServers(filePath: string, key: string): Set<string> {
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(config[key])) return new Set(config[key].filter((s: unknown) => typeof s === 'string'));
  } catch {}
  return new Set();
}

function countHooksInFile(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (config.hooks && typeof config.hooks === 'object') return Object.keys(config.hooks).length;
  } catch {}
  return 0;
}

function countRulesInDir(rulesDir: string): number {
  if (!fs.existsSync(rulesDir)) return 0;
  let count = 0;
  try {
    for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
      const fullPath = path.join(rulesDir, entry.name);
      if (entry.isDirectory()) count += countRulesInDir(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.md')) count++;
    }
  } catch {}
  return count;
}

function normPath(p: string): string {
  let n = path.normalize(path.resolve(p));
  const root = path.parse(n).root;
  while (n.length > root.length && n.endsWith(path.sep)) n = n.slice(0, -1);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function samePath(a: string, b: string): boolean {
  if (normPath(a) === normPath(b)) return true;
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  try { return normPath(fs.realpathSync.native(a)) === normPath(fs.realpathSync.native(b)); } catch { return false; }
}

export async function countConfigs(cwd?: string): Promise<ConfigCounts> {
  let claudeMdCount = 0, rulesCount = 0, hooksCount = 0;
  const claudeDir = getClaudeConfigDir();
  const userMcpServers = new Set<string>();
  const projectMcpServers = new Set<string>();

  // User scope
  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) claudeMdCount++;
  rulesCount += countRulesInDir(path.join(claudeDir, 'rules'));
  const userSettings = path.join(claudeDir, 'settings.json');
  for (const name of getMcpServerNames(userSettings)) userMcpServers.add(name);
  hooksCount += countHooksInFile(userSettings);
  const userJson = `${claudeDir}.json`;
  for (const name of getMcpServerNames(userJson)) userMcpServers.add(name);
  for (const name of getDisabledMcpServers(userJson, 'disabledMcpServers')) userMcpServers.delete(name);

  // Project scope
  const projectClaudeDir = cwd ? path.join(cwd, '.claude') : null;
  const overlaps = projectClaudeDir ? samePath(projectClaudeDir, claudeDir) : false;

  if (cwd) {
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) claudeMdCount++;
    if (fs.existsSync(path.join(cwd, 'CLAUDE.local.md'))) claudeMdCount++;
    if (!overlaps && fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md'))) claudeMdCount++;
    if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.local.md'))) claudeMdCount++;
    if (!overlaps) rulesCount += countRulesInDir(path.join(cwd, '.claude', 'rules'));

    const mcpJsonServers = getMcpServerNames(path.join(cwd, '.mcp.json'));
    const projectSettings = path.join(cwd, '.claude', 'settings.json');
    if (!overlaps) { for (const n of getMcpServerNames(projectSettings)) projectMcpServers.add(n); hooksCount += countHooksInFile(projectSettings); }
    const localSettings = path.join(cwd, '.claude', 'settings.local.json');
    for (const n of getMcpServerNames(localSettings)) projectMcpServers.add(n);
    hooksCount += countHooksInFile(localSettings);
    for (const n of getDisabledMcpServers(localSettings, 'disabledMcpjsonServers')) mcpJsonServers.delete(n);
    for (const n of mcpJsonServers) projectMcpServers.add(n);
  }

  return { claudeMdCount, rulesCount, mcpCount: userMcpServers.size + projectMcpServers.size, hooksCount };
}
