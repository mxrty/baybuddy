type LogLevel = "debug" | "log" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  section?: string;
  label: string;
  data?: unknown;
  timestamp: string;
}

const MAX_LOGS = 5000;
let _enabled = false;
const _buffer: LogEntry[] = [];
let _logEl: HTMLScriptElement | null = null;
let _syncTimeout: ReturnType<typeof setTimeout> | null = null;

function syncDom(): void {
  try {
    if (!_logEl) {
      _logEl = document.createElement("script");
      _logEl.type = "application/json";
      _logEl.id = "__bb_debug_log";
      (document.documentElement ?? document.body).appendChild(_logEl);
    }
    _logEl.textContent = JSON.stringify({ url: location.href, logs: _buffer });
  } catch (_) {}
}

function scheduleSyncDom(): void {
  if (_syncTimeout !== null) {
    clearTimeout(_syncTimeout);
  }
  _syncTimeout = setTimeout(() => {
    syncDom();
    _syncTimeout = null;
  }, 1000);
}

function push(entry: LogEntry): void {
  _buffer.push(entry);
  if (_buffer.length > MAX_LOGS) {
    _buffer.shift();
  }
  scheduleSyncDom();
}

export function initDebug(enabled: boolean): void {
  _enabled = enabled;
}

export function isDebugEnabled(): boolean {
  return _enabled;
}

export function getDebugLog(): { url: string; logs: LogEntry[] } {
  return { url: location.href, logs: _buffer };
}

export function downloadDebugLog(): void {
  const data = getDebugLog();
  const slug = location.hostname.replace(/\./g, "-") + "-" + Date.now();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `debug-logs/${slug}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Keep references to originals for use inside dbg() to avoid capturing console noise
const _origLog = console.log.bind(console);

// data is a thunk so object literals + JSON.stringify are zero-cost when disabled
export function dbg(section: string, label: string, data?: () => unknown): void {
  if (!_enabled) return;
  const prefix = `[BayBuddy:DEBUG:${section}]`;
  if (data) {
    const payload = data();
    push({ level: "debug", section, label, data: payload, timestamp: new Date().toISOString() });
    _origLog(prefix, label, payload);
  } else {
    push({ level: "debug", section, label, timestamp: new Date().toISOString() });
    _origLog(prefix, label);
  }
}

// Synchronous group wrappers — do NOT use around async code (open group across await mis-nests)
export function dbgGroupStart(section: string, label: string): void {
  if (!_enabled) return;
  console.group(`[BayBuddy:DEBUG:${section}] ${label}`);
}

export function dbgGroupEnd(): void {
  if (!_enabled) return;
  console.groupEnd();
}
