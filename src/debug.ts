let _enabled = false;

export function initDebug(enabled: boolean): void {
  _enabled = enabled;
}

export function isDebugEnabled(): boolean {
  return _enabled;
}

// data is a thunk so object literals + JSON.stringify are zero-cost when disabled
export function dbg(section: string, label: string, data?: () => unknown): void {
  if (!_enabled) return;
  const prefix = `[BayBuddy:DEBUG:${section}]`;
  if (data) {
    const payload = data();
    if (typeof payload === "object" && payload !== null) {
      console.log(prefix, label);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(prefix, label, payload);
    }
  } else {
    console.log(prefix, label);
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
