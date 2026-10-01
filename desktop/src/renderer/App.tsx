import { Activity, FolderPlus, Layers, PenSquare, Settings as SettingsIcon, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppState, ContentType, PlatformMeta, SiteMeta } from "../shared/types";
import { type InitData, api, errorMessage } from "./api";
import { AccountsView } from "./components/AccountsView";
import { ActivityView } from "./components/ActivityView";
import { ComposeView } from "./components/ComposeView";
import { SettingsView } from "./components/SettingsView";
import { Button, FeedbackProvider, Modal, cx, useFeedback } from "./components/ui";
import { AppContext, type View, useApp } from "./context";
import { setLanguage, t } from "./i18n";

export function App() {
  const [init, setInit] = useState<InitData | null>(null);
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    api.init().then((data: InitData) => {
      setLanguage(data.locale);
      setInit(data);
      setState(data.state);
    });
    return api.onState(setState);
  }, []);

  if (!init || !state) return <div className="h-full bg-background" />;
  return (
    <FeedbackProvider labels={{ cancel: t("cancel"), confirm: t("delete") }}>
      <Shell init={init} state={state} />
    </FeedbackProvider>
  );
}

function Shell({ init, state }: { init: InitData; state: AppState }) {
  const [view, setView] = useState<View>(() =>
    state.accounts.length === 0 ? { name: "accounts" } : { name: "compose" },
  );

  const sitesByKey = useMemo(() => new Map<string, SiteMeta>(init.sites.map((s) => [s.accountKey, s])), [init.sites]);
  const platformsFor = useCallback(
    (accountKey: string, type?: ContentType): PlatformMeta[] =>
      init.platforms.filter((p) => p.accountKey === accountKey && (!type || p.type === type)),
    [init.platforms],
  );

  const ctx = useMemo(
    () => ({ init, state, view, setView, sitesByKey, platformsFor }),
    [init, state, view, sitesByKey, platformsFor],
  );

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          {view.name === "compose" && <ComposeView />}
          {view.name === "accounts" && <AccountsView groupId={view.groupId} />}
          {view.name === "activity" && <ActivityView />}
          {view.name === "settings" && <SettingsView />}
        </main>
      </div>
    </AppContext.Provider>
  );
}

function Sidebar() {
  const { state, view, setView } = useApp();
  const { toast } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const running = state.jobs.filter(
    (j) => j.status === "queued" || j.status === "loading" || j.status === "injecting",
  ).length;

  const nav: { key: View["name"]; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "compose", label: t("navCompose"), icon: <PenSquare size={17} /> },
    { key: "accounts", label: t("navAccounts"), icon: <Users size={17} /> },
    { key: "activity", label: t("navActivity"), icon: <Activity size={17} />, badge: running || undefined },
    { key: "settings", label: t("navSettings"), icon: <SettingsIcon size={17} /> },
  ];

  const createGroup = async () => {
    try {
      const group = await api.createGroup(name);
      setCreating(false);
      setName("");
      setView({ name: "accounts", groupId: group.id });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <img src="../icon.png" alt="" className="h-8 w-8 rounded-lg" draggable={false} />
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold">MultiPost</span>
          <span className="text-[11px] text-muted">Desktop</span>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {nav.map((item) => {
          const active =
            view.name === item.key && !(item.key === "accounts" && view.name === "accounts" && view.groupId);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setView({ name: item.key } as View)}
              className={cx(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left font-medium transition",
                active
                  ? "bg-primary-50 text-primary-700 dark:text-primary-500"
                  : "text-foreground/80 hover:bg-elevated",
              )}>
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-primary-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-between px-4 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("groups")}</span>
        <button
          type="button"
          title={t("newGroup")}
          aria-label={t("newGroup")}
          onClick={() => setCreating(true)}
          className="rounded-md p-1 text-muted hover:bg-elevated hover:text-foreground">
          <FolderPlus size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {state.groups.length === 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mx-1 mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-xs text-muted hover:border-primary-500 hover:text-foreground">
            <Layers size={15} />
            {t("newGroup")}
          </button>
        )}
        {state.groups.map((g) => {
          const active = view.name === "accounts" && view.groupId === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setView({ name: "accounts", groupId: g.id })}
              className={cx(
                "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left transition",
                active ? "bg-elevated font-medium" : "text-foreground/80 hover:bg-elevated",
              )}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="text-xs tabular-nums text-muted">{g.accountIds.length}</span>
            </button>
          );
        })}
      </div>

      <Modal
        open={creating}
        title={t("newGroup")}
        onClose={() => setCreating(false)}
        width={400}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t("cancel")}</Button>
            <Button variant="primary" disabled={!name.trim()} onClick={createGroup}>
              {t("create")}
            </Button>
          </>
        }>
        <input
          className="field"
          autoFocus
          placeholder={t("groupName")}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && createGroup()}
        />
      </Modal>
    </aside>
  );
}
