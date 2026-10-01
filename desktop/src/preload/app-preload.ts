// Bridge between the app UI and the main process. Only these calls are reachable from the UI.
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppState } from "../shared/types";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  init: () => invoke("app:init"),
  onState: (cb: (state: AppState) => void) => {
    const listener = (_e: unknown, state: AppState) => cb(state);
    ipcRenderer.on("state", listener);
    return () => {
      ipcRenderer.removeListener("state", listener);
    };
  },
  createGroup: (name: string) => invoke("group:create", name),
  updateGroup: (id: string, patch: unknown) => invoke("group:update", id, patch),
  deleteGroup: (id: string) => invoke("group:delete", id),
  reorderGroups: (ids: string[]) => invoke("group:reorder", ids),
  createAccount: (input: unknown) => invoke("account:create", input),
  updateAccount: (id: string, patch: unknown) => invoke("account:update", id, patch),
  setAccountGroups: (id: string, groupIds: string[]) => invoke("account:setGroups", id, groupIds),
  deleteAccount: (id: string) => invoke("account:delete", id),
  loginAccount: (id: string) => invoke("account:login", id),
  detectAccount: (id: string) => invoke("account:detect", id),
  detectAllAccounts: () => invoke("account:detectAll"),
  signOutAccount: (id: string) => invoke("account:signOut", id),
  pickFiles: (kind: string, multiple: boolean) => invoke("files:pick", kind, multiple),
  filesFromDrop: (files: File[]) =>
    invoke("files:fromPaths", files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  publish: (request: unknown) => invoke("publish:start", request),
  retryJob: (id: string) => invoke("job:retry", id),
  cancelJob: (id: string) => invoke("job:cancel", id),
  showJob: (id: string) => invoke("job:show", id),
  retryableJobs: (ids: string[]) => invoke("job:canRetry", ids),
  openJobWindows: () => invoke("job:openWindows"),
  clearHistory: () => invoke("history:clear"),
  updateSettings: (patch: unknown) => invoke("settings:update", patch),
  exportData: () => invoke("data:export"),
  importData: () => invoke("data:import"),
  openDataFolder: () => invoke("data:openFolder"),
  relaunch: () => invoke("app:relaunch"),
  openExternal: (url: string) => invoke("app:openExternal", url),
};

contextBridge.exposeInMainWorld("multipost", api);

export type MultiPostApi = typeof api;
