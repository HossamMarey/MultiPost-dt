// Local JSON store. Everything stays on this machine under the app's userData folder.
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { type AppState, DEFAULT_SETTINGS } from "../shared/types";

const MAX_RUNS = 200;

function dataFile() {
  return path.join(app.getPath("userData"), "multipost-data.json");
}

function emptyState(): AppState {
  return { groups: [], accounts: [], settings: { ...DEFAULT_SETTINGS }, runs: [], jobs: [] };
}

let state: AppState = emptyState();
// Never write before the file was read: a second app instance or an early quit would otherwise
// overwrite the user's data with an empty state.
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: AppState) => void>();

function readDataFile(): Partial<AppState> {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), "utf8"));
  } catch (error) {
    // A torn or corrupt file: fall back to the last good copy.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && fs.existsSync(`${dataFile()}.bak`)) {
      console.error("Data file unreadable, restoring backup", error);
      return JSON.parse(fs.readFileSync(`${dataFile()}.bak`, "utf8"));
    }
    throw error;
  }
}

export function loadState(): AppState {
  try {
    const raw = readDataFile();
    state = {
      ...emptyState(),
      ...raw,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    };
    // Jobs that were running when the app quit can never finish.
    for (const job of state.jobs) {
      if (job.status === "queued" || job.status === "loading" || job.status === "injecting") {
        job.status = "cancelled";
        job.error = "App closed before the job finished";
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Keep the broken file for recovery instead of overwriting it silently.
      try {
        fs.copyFileSync(dataFile(), `${dataFile()}.corrupt-${Date.now()}`);
      } catch {}
      console.error("Failed to read data file, starting fresh", error);
    }
    state = emptyState();
  }
  loaded = true;
  return state;
}

export function getState(): AppState {
  return state;
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeNow() {
  if (!loaded) return;
  const file = dataFile();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(state, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // backup is best effort
  }
  // Atomic replace. On Windows antivirus/indexers briefly lock files (EPERM/EBUSY): retry.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 6 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw error;
      sleepSync(50 * 2 ** attempt);
    }
  }
}

function scheduleSave(delay: number) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeNow();
    } catch (error) {
      console.error("Failed to save data, retrying", error);
      scheduleSave(2000);
    }
  }, delay);
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeNow();
}

export function update(mutator: (s: AppState) => void) {
  mutator(state);
  if (state.runs.length > MAX_RUNS) {
    const dropped = state.runs.splice(0, state.runs.length - MAX_RUNS);
    const droppedJobs = new Set(dropped.flatMap((r) => r.jobIds));
    state.jobs = state.jobs.filter((j) => !droppedJobs.has(j.id));
  }
  for (const l of listeners) l(state);
  scheduleSave(250);
}

export function onChange(listener: (s: AppState) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function replaceState(next: AppState) {
  update((s) => {
    s.groups = next.groups ?? [];
    s.accounts = next.accounts ?? [];
    s.settings = { ...DEFAULT_SETTINGS, ...(next.settings ?? {}) };
    s.runs = next.runs ?? [];
    s.jobs = next.jobs ?? [];
  });
}
