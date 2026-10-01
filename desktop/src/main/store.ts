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
let saveTimer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: AppState) => void>();

export function loadState(): AppState {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(), "utf8")) as Partial<AppState>;
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
  return state;
}

export function getState(): AppState {
  return state;
}

function writeNow() {
  const file = dataFile();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic replace so a crash never leaves a half-written file
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
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        writeNow();
      } catch (error) {
        console.error("Failed to save data", error);
      }
    }, 250);
  }
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
