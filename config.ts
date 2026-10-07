import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type LineLayoutType = 'compact' | 'expanded';
export type AutocompactBufferMode = 'enabled' | 'disabled';
export type ContextValueMode = 'percent' | 'tokens' | 'remaining' | 'both';
export type HudElement = 'project' | 'context' | 'usage' | 'tokens' | 'cache' | 'environment' | 'connectivity' | 'tools' | 'agents' | 'todos';
export type HudColorName = 'dim' | 'red' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'brightBlue' | 'brightMagenta';
export type HudColorValue = HudColorName | number | string;

export interface HudColorOverrides {
  context: HudColorValue;
  usage: HudColorValue;
  warning: HudColorValue;
  usageWarning: HudColorValue;
  critical: HudColorValue;
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  custom: HudColorValue;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  'project', 'context', 'usage', 'tokens', 'cache', 'environment', 'connectivity', 'tools', 'agents', 'todos',
];

const KNOWN_ELEMENTS = new Set<HudElement>(DEFAULT_ELEMENT_ORDER);

export interface HudConfig {
  lineLayout: LineLayoutType;
  showSeparators: boolean;
  pathLevels: 1 | 2 | 3;
  elementOrder: HudElement[];
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    showFileStats: boolean;
    showPR: boolean;
  };
  display: {
    showModel: boolean;
    showEffort: boolean;
    showLinesChanged: boolean;
    showProject: boolean;
    showContextBar: boolean;
    showCompactLine: boolean;
    contextValue: ContextValueMode;
    showConfigCounts: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    usageBarEnabled: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showSessionName: boolean;
    showClaudeCodeVersion: boolean;
    showTokens: boolean;
    showConnectivity: boolean;
    showCache: boolean;
    showPermissionMode: boolean;
    subagentLineColors: boolean;
    connectivityUrl: string;
    ipdataApiKey: string;
    ipdataBaseUrl: string;
    customLine: string;
    autocompactBuffer: AutocompactBufferMode;
    usageThreshold: number;
    sevenDayThreshold: number;
    environmentThreshold: number;
  };
  colors: HudColorOverrides;
}

export const DEFAULT_CONFIG: HudConfig = {
  lineLayout: 'expanded',
  showSeparators: false,
  pathLevels: 1,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, showPR: true },
  display: {
    showModel: true,
    showEffort: true,
    showLinesChanged: false,
    showProject: true,
    showContextBar: true,
    showCompactLine: true,
    contextValue: 'percent',
    showConfigCounts: false,
    showDuration: false,
    showSpeed: false,
    showTokenBreakdown: true,
    showUsage: true,
    usageBarEnabled: true,
    showTools: false,
    showAgents: false,
    showTodos: false,
    showSessionName: false,
    showClaudeCodeVersion: false,
    showTokens: false,
    showConnectivity: false,
    showCache: true,
    showPermissionMode: true,
    subagentLineColors: false,
    connectivityUrl: 'https://api.anthropic.com/cdn-cgi/trace',
    ipdataApiKey: '',
    ipdataBaseUrl: 'https://api.ipdata.co',
    customLine: '',
    autocompactBuffer: 'enabled',
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
  },
  colors: {
    context: 'green',
    usage: 'brightBlue',
    warning: 'yellow',
    usageWarning: 'brightMagenta',
    critical: 'red',
    model: 'magenta', // muted purple — same family as agent types: "which brain is running"
    project: 'yellow',
    git: 243,        // the git:( ) wrapper is chrome, not information — keep it gray
    gitBranch: 146,  // soft lavender so the branch reads apart from the teal model bracket
    label: 'dim',
    custom: 208,
  },
};

function getConfigDir(): string {
  const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) {
    if (envDir === '~') return os.homedir();
    if (envDir.startsWith('~/') || envDir.startsWith('~\\')) return path.join(os.homedir(), envDir.slice(2));
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), '.claude');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'hud', 'config.json');
}

export function getClaudeConfigDir(): string {
  return getConfigDir();
}

export function getHudDir(): string {
  return path.join(getConfigDir(), 'hud');
}

function validateLineLayout(v: unknown): v is LineLayoutType { return v === 'compact' || v === 'expanded'; }
function validateAutocompact(v: unknown): v is AutocompactBufferMode { return v === 'enabled' || v === 'disabled'; }
function validateContextValue(v: unknown): v is ContextValueMode { return v === 'percent' || v === 'tokens' || v === 'remaining' || v === 'both'; }
function validatePathLevels(v: unknown): v is 1 | 2 | 3 { return v === 1 || v === 2 || v === 3; }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function validateColor(v: unknown): v is HudColorValue {
  if (typeof v === 'string' && ['dim','red','green','yellow','magenta','cyan','brightBlue','brightMagenta'].includes(v)) return true;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255) return true;
  if (typeof v === 'string' && HEX_COLOR.test(v)) return true;
  return false;
}

function validateElementOrder(value: unknown): HudElement[] {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_ELEMENT_ORDER];
  const seen = new Set<HudElement>();
  const order: HudElement[] = [];
  for (const item of value) {
    if (typeof item === 'string' && KNOWN_ELEMENTS.has(item as HudElement) && !seen.has(item as HudElement)) {
      seen.add(item as HudElement);
      order.push(item as HudElement);
    }
  }
  return order.length > 0 ? order : [...DEFAULT_ELEMENT_ORDER];
}

interface LegacyConfig { layout?: 'default' | 'separators' | Record<string, unknown>; }

function migrateConfig(c: Partial<HudConfig> & LegacyConfig): Partial<HudConfig> {
  const m = { ...c } as Partial<HudConfig> & LegacyConfig;
  if ('layout' in c && !('lineLayout' in c)) {
    if (typeof c.layout === 'string') {
      m.lineLayout = 'compact';
      m.showSeparators = c.layout === 'separators';
    } else if (typeof c.layout === 'object' && c.layout !== null) {
      const obj = c.layout as Record<string, unknown>;
      if (typeof obj.lineLayout === 'string') m.lineLayout = obj.lineLayout as any;
      if (typeof obj.showSeparators === 'boolean') m.showSeparators = obj.showSeparators;
      if (typeof obj.pathLevels === 'number') m.pathLevels = obj.pathLevels as any;
    }
    delete m.layout;
  }
  return m;
}

function bool(v: unknown, def: boolean): boolean { return typeof v === 'boolean' ? v : def; }
function threshold(v: unknown, max = 100): number { return typeof v === 'number' ? Math.max(0, Math.min(max, v)) : 0; }

export function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
  const c = migrateConfig(userConfig);
  return {
    lineLayout: validateLineLayout(c.lineLayout) ? c.lineLayout : DEFAULT_CONFIG.lineLayout,
    showSeparators: bool(c.showSeparators, DEFAULT_CONFIG.showSeparators),
    pathLevels: validatePathLevels(c.pathLevels) ? c.pathLevels : DEFAULT_CONFIG.pathLevels,
    elementOrder: validateElementOrder(c.elementOrder),
    gitStatus: {
      enabled: bool(c.gitStatus?.enabled, DEFAULT_CONFIG.gitStatus.enabled),
      showDirty: bool(c.gitStatus?.showDirty, DEFAULT_CONFIG.gitStatus.showDirty),
      showAheadBehind: bool(c.gitStatus?.showAheadBehind, DEFAULT_CONFIG.gitStatus.showAheadBehind),
      showFileStats: bool(c.gitStatus?.showFileStats, DEFAULT_CONFIG.gitStatus.showFileStats),
      showPR: bool(c.gitStatus?.showPR, DEFAULT_CONFIG.gitStatus.showPR),
    },
    display: {
      showModel: bool(c.display?.showModel, DEFAULT_CONFIG.display.showModel),
      showEffort: bool(c.display?.showEffort, DEFAULT_CONFIG.display.showEffort),
      showLinesChanged: bool(c.display?.showLinesChanged, DEFAULT_CONFIG.display.showLinesChanged),
      showProject: bool(c.display?.showProject, DEFAULT_CONFIG.display.showProject),
      showContextBar: bool(c.display?.showContextBar, DEFAULT_CONFIG.display.showContextBar),
      showCompactLine: bool(c.display?.showCompactLine, DEFAULT_CONFIG.display.showCompactLine),
      contextValue: validateContextValue(c.display?.contextValue) ? c.display!.contextValue : DEFAULT_CONFIG.display.contextValue,
      showConfigCounts: bool(c.display?.showConfigCounts, DEFAULT_CONFIG.display.showConfigCounts),
      showDuration: bool(c.display?.showDuration, DEFAULT_CONFIG.display.showDuration),
      showSpeed: bool(c.display?.showSpeed, DEFAULT_CONFIG.display.showSpeed),
      showTokenBreakdown: bool(c.display?.showTokenBreakdown, DEFAULT_CONFIG.display.showTokenBreakdown),
      showUsage: bool(c.display?.showUsage, DEFAULT_CONFIG.display.showUsage),
      usageBarEnabled: bool(c.display?.usageBarEnabled, DEFAULT_CONFIG.display.usageBarEnabled),
      showTools: bool(c.display?.showTools, DEFAULT_CONFIG.display.showTools),
      showAgents: bool(c.display?.showAgents, DEFAULT_CONFIG.display.showAgents),
      showTodos: bool(c.display?.showTodos, DEFAULT_CONFIG.display.showTodos),
      showSessionName: bool(c.display?.showSessionName, DEFAULT_CONFIG.display.showSessionName),
      showClaudeCodeVersion: bool(c.display?.showClaudeCodeVersion, DEFAULT_CONFIG.display.showClaudeCodeVersion),
      showTokens: bool(c.display?.showTokens, DEFAULT_CONFIG.display.showTokens),
      showConnectivity: bool(c.display?.showConnectivity, DEFAULT_CONFIG.display.showConnectivity),
      showCache: bool(c.display?.showCache, DEFAULT_CONFIG.display.showCache),
      showPermissionMode: bool(c.display?.showPermissionMode, DEFAULT_CONFIG.display.showPermissionMode),
      subagentLineColors: bool(c.display?.subagentLineColors, DEFAULT_CONFIG.display.subagentLineColors),
      connectivityUrl: typeof c.display?.connectivityUrl === 'string' && /^https?:\/\//.test(c.display.connectivityUrl) ? c.display.connectivityUrl : DEFAULT_CONFIG.display.connectivityUrl,
      ipdataApiKey: typeof c.display?.ipdataApiKey === 'string' ? c.display.ipdataApiKey.trim() : DEFAULT_CONFIG.display.ipdataApiKey,
      ipdataBaseUrl: typeof c.display?.ipdataBaseUrl === 'string' && /^https?:\/\//.test(c.display.ipdataBaseUrl) ? c.display.ipdataBaseUrl : DEFAULT_CONFIG.display.ipdataBaseUrl,
      customLine: typeof c.display?.customLine === 'string' ? c.display.customLine.slice(0, 80) : DEFAULT_CONFIG.display.customLine,
      autocompactBuffer: validateAutocompact(c.display?.autocompactBuffer) ? c.display!.autocompactBuffer : DEFAULT_CONFIG.display.autocompactBuffer,
      usageThreshold: typeof c.display?.usageThreshold === 'number' ? threshold(c.display.usageThreshold) : DEFAULT_CONFIG.display.usageThreshold,
      sevenDayThreshold: typeof c.display?.sevenDayThreshold === 'number' ? threshold(c.display.sevenDayThreshold) : DEFAULT_CONFIG.display.sevenDayThreshold,
      environmentThreshold: typeof c.display?.environmentThreshold === 'number' ? threshold(c.display.environmentThreshold) : DEFAULT_CONFIG.display.environmentThreshold,
    },
    colors: {
      context: validateColor(c.colors?.context) ? c.colors!.context : DEFAULT_CONFIG.colors.context,
      usage: validateColor(c.colors?.usage) ? c.colors!.usage : DEFAULT_CONFIG.colors.usage,
      warning: validateColor(c.colors?.warning) ? c.colors!.warning : DEFAULT_CONFIG.colors.warning,
      usageWarning: validateColor(c.colors?.usageWarning) ? c.colors!.usageWarning : DEFAULT_CONFIG.colors.usageWarning,
      critical: validateColor(c.colors?.critical) ? c.colors!.critical : DEFAULT_CONFIG.colors.critical,
      model: validateColor(c.colors?.model) ? c.colors!.model : DEFAULT_CONFIG.colors.model,
      project: validateColor(c.colors?.project) ? c.colors!.project : DEFAULT_CONFIG.colors.project,
      git: validateColor(c.colors?.git) ? c.colors!.git : DEFAULT_CONFIG.colors.git,
      gitBranch: validateColor(c.colors?.gitBranch) ? c.colors!.gitBranch : DEFAULT_CONFIG.colors.gitBranch,
      label: validateColor(c.colors?.label) ? c.colors!.label : DEFAULT_CONFIG.colors.label,
      custom: validateColor(c.colors?.custom) ? c.colors!.custom : DEFAULT_CONFIG.colors.custom,
    },
  };
}

function readRawConfig(p: string): Partial<HudConfig> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<HudConfig>; } catch { return null; }
}

/** Shallow-merge `over` onto `base`, with a one-level merge of the nested
 * display/colors/gitStatus objects so a local override can set a single key. */
function overlayConfig(base: Partial<HudConfig>, over: Partial<HudConfig>): Partial<HudConfig> {
  const out: any = { ...base, ...over };
  for (const k of ['display', 'colors', 'gitStatus'] as const) {
    if (base[k] || over[k]) out[k] = { ...(base[k] as object ?? {}), ...(over[k] as object ?? {}) };
  }
  return out;
}

export async function loadConfig(): Promise<HudConfig> {
  const dir = path.dirname(getConfigPath());
  // config.json holds shareable prefs; config.local.json (gitignored) holds
  // machine-specific overrides and secrets and wins on conflict.
  const base = readRawConfig(path.join(dir, 'config.json'));
  const local = readRawConfig(path.join(dir, 'config.local.json'));
  const cfg = mergeConfig(base || local ? overlayConfig(base ?? {}, local ?? {}) : {});

  // Secret fallback: never require the key to live in a committed file.
  if (!cfg.display.ipdataApiKey) {
    const env = process.env.IPDATA_API_KEY?.trim();
    if (env) cfg.display.ipdataApiKey = env;
  }
  return cfg;
}
