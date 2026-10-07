import { test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { countClaudeMdInAncestors } from './config-reader.ts';

function tree(): { root: string; pkg: string; claudeDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-claudemd-'));
  const claudeDir = path.join(root, 'home', '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), '# user scope');
  const lab = path.join(root, 'home', 'lab');
  const pkg = path.join(lab, 'repo', 'packages', 'core');
  fs.mkdirSync(path.join(pkg, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(lab, 'CLAUDE.md'), '# lab-wide');            // ancestor, 2 levels up
  fs.writeFileSync(path.join(lab, 'repo', 'CLAUDE.md'), '# repo');        // ancestor, 1 level up
  fs.writeFileSync(path.join(lab, 'repo', 'CLAUDE.local.md'), '# local'); // sibling variant
  fs.writeFileSync(path.join(pkg, '.claude', 'CLAUDE.md'), '# nested');   // .claude/CLAUDE.md in cwd
  return { root, pkg, claudeDir };
}

test('counts CLAUDE.md in cwd and every ancestor, like the engine does', () => {
  const { root, pkg, claudeDir } = tree();
  try {
    // lab/CLAUDE.md + repo/CLAUDE.md + repo/CLAUDE.local.md + core/.claude/CLAUDE.md
    expect(countClaudeMdInAncestors(pkg, claudeDir)).toBe(4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an ancestor whose .claude IS the config dir is not double-counted', () => {
  const { root, claudeDir } = tree();
  try {
    // cwd = home: home/.claude/CLAUDE.md is the user-scope file the caller already counted
    expect(countClaudeMdInAncestors(path.join(root, 'home'), claudeDir)).toBe(0);
    // cwd = home/.claude/hud (working inside the config dir): still 0 from the walk
    fs.mkdirSync(path.join(claudeDir, 'hud'), { recursive: true });
    expect(countClaudeMdInAncestors(path.join(claudeDir, 'hud'), claudeDir)).toBe(0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no files anywhere → 0, and the walk terminates at the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-claudemd-empty-'));
  try { expect(countClaudeMdInAncestors(root, path.join(root, 'nope'))).toBeGreaterThanOrEqual(0); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
