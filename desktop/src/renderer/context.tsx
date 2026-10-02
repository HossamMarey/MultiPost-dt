import { createContext, useContext } from "react";
import type { Account, AppState, ContentType, PlatformMeta, SiteMeta } from "../shared/types";
import type { InitData } from "./api";

export type View =
  | { name: "compose" }
  | { name: "accounts"; groupId?: string }
  | { name: "activity" }
  | { name: "settings" };

export interface AppContextValue {
  init: InitData;
  state: AppState;
  view: View;
  setView: (v: View) => void;
  sitesByKey: Map<string, SiteMeta>;
  platformsFor: (accountKey: string, type?: ContentType) => PlatformMeta[];
}

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);

export function useApp() {
  return useContext(AppContext);
}

export function accountDisplayName(account: Account): string {
  return account.profile?.username
    ? `${account.label} · @${account.profile.username.replace(/^@/, "")}`
    : account.label;
}
