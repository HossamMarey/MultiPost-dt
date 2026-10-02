import {
  Check,
  Globe,
  LogIn,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ContentType, Group, SiteMeta } from "../../shared/types";
import { GROUP_COLORS } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../context";
import { t, timeAgo } from "../i18n";
import { TagInput } from "./ComposeView";
import { Button, Checkbox, EmptyState, Favicon, Field, IconButton, Modal, cx, useFeedback } from "./ui";

export function AccountsView({ groupId }: { groupId?: string }) {
  const { state, sitesByKey } = useApp();
  const { toast } = useFeedback();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [members, setMembers] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "logged-in" | "attention">("all");

  const group = groupId ? state.groups.find((g) => g.id === groupId) : undefined;
  const scoped = useMemo(
    () => (group ? state.accounts.filter((a) => group.accountIds.includes(a.id)) : state.accounts),
    [state.accounts, group],
  );
  const counts = useMemo(
    () => ({
      in: scoped.filter((a) => a.status === "logged-in").length,
      out: scoped.filter((a) => a.status === "logged-out").length,
      unknown: scoped.filter((a) => a.status === "unknown").length,
    }),
    [scoped],
  );
  const accounts = useMemo(() => {
    let list = scoped;
    if (statusFilter === "logged-in") list = list.filter((a) => a.status === "logged-in");
    if (statusFilter === "attention") list = list.filter((a) => a.status !== "logged-in");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        [a.label, a.profile?.username, sitesByKey.get(a.accountKey)?.label, a.accountKey].some((v) =>
          v?.toLowerCase().includes(q),
        ),
      );
    }
    return [...list].sort(
      (a, b) =>
        (sitesByKey.get(a.accountKey)?.label ?? "").localeCompare(sitesByKey.get(b.accountKey)?.label ?? "") ||
        a.label.localeCompare(b.label),
    );
  }, [scoped, statusFilter, query, sitesByKey]);

  const checkAll = async () => {
    setChecking(true);
    try {
      await api.detectAllAccounts();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setChecking(false);
    }
  };

  const filterOptions: { value: typeof statusFilter; label: string; count: number }[] = [
    { value: "all", label: t("filterAll"), count: scoped.length },
    { value: "logged-in", label: t("statusLoggedIn"), count: counts.in },
    { value: "attention", label: t("filterNeedsSignIn"), count: counts.out + counts.unknown },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border bg-surface/60 px-6 pb-3 pt-4">
        <div className="flex items-center gap-3">
          {group ? <GroupHeader group={group} /> : <h1 className="text-lg font-semibold">{t("allAccounts")}</h1>}
          {scoped.length > 0 && (
            <span className="text-xs text-muted">
              {t("signedInSummary", { n: counts.in, total: scoped.length })}
              {counts.out > 0 && <span className="text-warning"> · {t("notSignedInCount", { n: counts.out })}</span>}
            </span>
          )}
          <div className="flex-1" />
          {group && state.accounts.length > 0 && (
            <Button onClick={() => setMembers(true)} icon={<Users size={15} />}>
              {t("manageMembers")}
            </Button>
          )}
          <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus size={16} />}>
            {t("addAccount")}
          </Button>
        </div>
        {scoped.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-elevated p-0.5">
              {filterOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatusFilter(o.value)}
                  className={cx(
                    "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    statusFilter === o.value ? "bg-surface shadow-card" : "text-muted hover:text-foreground",
                  )}>
                  {o.label}
                  <span className="tabular-nums text-muted">{o.count}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="field h-8 w-56 py-0 pl-8"
                placeholder={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={checkAll}
              disabled={checking}
              icon={<RefreshCw size={14} className={checking ? "animate-spin-slow" : ""} />}>
              {t("checkAll")}
            </Button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {scoped.length === 0 ? (
          group ? (
            <EmptyState
              icon={<Users size={22} />}
              title={t("emptyGroupTitle")}
              body={t("emptyGroupBody")}
              action={
                <div className="flex gap-2">
                  {state.accounts.length > 0 && <Button onClick={() => setMembers(true)}>{t("manageMembers")}</Button>}
                  <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus size={16} />}>
                    {t("addAccount")}
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={<UserPlus size={22} />}
              title={t("noAccountsTitle")}
              body={t("noAccountsBody")}
              action={
                <Button variant="primary" size="lg" onClick={() => setAdding(true)} icon={<Plus size={17} />}>
                  {t("addAccount")}
                </Button>
              }
            />
          )
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                site={sitesByKey.get(a.accountKey)}
                currentGroupId={groupId}
                onEdit={() => setEditing(a)}
              />
            ))}
          </div>
        )}
      </div>

      {adding && <AddAccountModal defaultGroupId={groupId} onClose={() => setAdding(false)} />}
      {editing && <EditAccountModal account={editing} onClose={() => setEditing(null)} />}
      {members && group && <GroupMembersModal group={group} onClose={() => setMembers(false)} />}
    </div>
  );
}

function GroupSettingsModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { toast } = useFeedback();
  const [footer, setFooter] = useState(group.footer ?? "");
  const [hashtags, setHashtags] = useState<string[]>(group.hashtags ?? []);
  const save = async () => {
    try {
      await api.updateGroup(group.id, { footer, hashtags });
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  return (
    <Modal
      open
      title={`${t("groupSettings")} · ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={save}>
            {t("save")}
          </Button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <Field label={t("groupFooter")} hint={t("groupFooterHint")}>
          <textarea
            className="field min-h-[90px] resize-y"
            placeholder="— Follow {account} for more"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
          />
        </Field>
        <Field label={t("groupHashtags")}>
          <TagInput tags={hashtags} onChange={setHashtags} />
        </Field>
      </div>
    </Modal>
  );
}

function GroupHeader({ group }: { group: Group }) {
  const { setView } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { confirm, toast } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);

  const save = () => {
    setEditing(false);
    if (name.trim() && name !== group.name)
      api.updateGroup(group.id, { name }).catch((e) => toast(errorMessage(e), "error"));
  };

  return (
    <div className="flex items-center gap-2">
      <ColorPicker value={group.color} onChange={(color) => api.updateGroup(group.id, { color })} />
      {editing ? (
        <input
          className="field h-9 w-56 py-0 text-base font-semibold"
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setName(group.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h1 className="text-lg font-semibold">{group.name}</h1>
      )}
      <IconButton label={t("groupSettings")} onClick={() => setSettingsOpen(true)}>
        <SlidersHorizontal size={14} />
      </IconButton>
      {settingsOpen && <GroupSettingsModal group={group} onClose={() => setSettingsOpen(false)} />}
      <IconButton label={t("rename")} onClick={() => setEditing(true)}>
        <Pencil size={14} />
      </IconButton>
      <IconButton
        label={t("delete")}
        onClick={async () => {
          if (await confirm(t("deleteGroupConfirm", { name: group.name }), { danger: true })) {
            await api.deleteGroup(group.id);
            setView({ name: "accounts" });
          }
        }}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Color"
        onClick={() => setOpen(!open)}
        className="h-4 w-4 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-surface hover:ring-border"
        style={{ background: value }}
      />
      {open && (
        <div className="absolute left-0 top-7 z-30 grid grid-cols-4 gap-2 rounded-xl border border-border bg-surface p-3 shadow-pop">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: c }}>
              {c === value && <Check size={13} className="text-white" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ account, site }: { account: Account; site?: SiteMeta }) {
  if (account.status === "logged-in") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("statusLoggedIn")}
      </span>
    );
  }
  if (account.status === "logged-out") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {t("statusLoggedOut")}
      </span>
    );
  }
  return (
    <span
      title={site?.canDetect ? undefined : t("statusUnknownHint")}
      className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />
      {t("statusUnknown")}
    </span>
  );
}

function AccountCard({
  account,
  site,
  currentGroupId,
  onEdit,
}: { account: Account; site?: SiteMeta; currentGroupId?: string; onEdit: () => void }) {
  const { state } = useApp();
  const { toast, confirm } = useFeedback();
  const [checking, setChecking] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Inside a group page, that group's own chip is noise.
  const groups = state.groups.filter((g) => g.accountIds.includes(account.id) && g.id !== currentGroupId);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const check = async () => {
    setChecking(true);
    try {
      await api.detectAccount(account.id);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    setMenu(false);
    if (await confirm(t("deleteAccountConfirm", { name: account.label }), { danger: true })) {
      await api.deleteAccount(account.id).catch((e) => toast(errorMessage(e), "error"));
    }
  };

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition hover:border-primary-500/40">
      <div className="flex items-start gap-3">
        <div className="relative">
          {account.profile?.avatarUrl ? (
            <img
              src={account.profile.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-10 w-10 rounded-full bg-elevated object-cover"
              draggable={false}
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
            />
          ) : (
            <Favicon
              src={site?.faviconUrl}
              siteKey={site?.accountKey}
              label={site?.label ?? account.accountKey}
              size={40}
              className="rounded-full"
            />
          )}
          {account.profile?.avatarUrl && (
            <Favicon
              src={site?.faviconUrl}
              siteKey={site?.accountKey}
              label={site?.label ?? account.accountKey}
              size={18}
              className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{account.label}</div>
          <div className="truncate text-xs text-muted">
            {site?.label ?? account.accountKey}
            {account.profile?.username && <> · @{account.profile.username.replace(/^@/, "")}</>}
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <IconButton label={t("edit")} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={16} />
          </IconButton>
          {menu && (
            <div className="absolute right-0 top-9 z-30 flex w-52 flex-col rounded-xl border border-border bg-surface p-1 shadow-pop">
              <MenuItem
                icon={<Pencil size={14} />}
                onClick={() => {
                  setMenu(false);
                  onEdit();
                }}>
                {t("edit")}
              </MenuItem>
              <MenuItem
                icon={<Shield size={14} />}
                onClick={async () => {
                  setMenu(false);
                  await api.signOutAccount(account.id).catch((e) => toast(errorMessage(e), "error"));
                }}>
                {t("signOut")}
              </MenuItem>
              <MenuItem icon={<Trash2 size={14} />} danger onClick={remove}>
                {t("delete")}
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-[22px] flex-wrap items-center gap-1.5">
        <StatusBadge account={account} site={site} />
        {account.proxy && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted"
            title={account.proxy}>
            <Globe size={11} />
            {t("proxy")}
          </span>
        )}
        {groups.map((g) => (
          <span
            key={g.id}
            className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-foreground/80">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color }} />
            {g.name}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant={account.status === "logged-in" ? "secondary" : "primary"}
          onClick={() => api.loginAccount(account.id).catch((e) => toast(errorMessage(e), "error"))}
          icon={<LogIn size={13} />}>
          {account.status === "logged-in" ? t("openBrowser") : t("signIn")}
        </Button>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted">
          {account.profile?.checkedAt ? t("lastChecked", { time: timeAgo(account.profile.checkedAt) }) : ""}
        </span>
        {site?.canDetect && (
          <IconButton label={t("checkStatus")} onClick={check} disabled={checking}>
            <RefreshCw size={14} className={checking ? "animate-spin-slow" : ""} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-8 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-elevated",
        danger && "text-danger",
      )}>
      {icon}
      {children}
    </button>
  );
}

function typeChips(site: SiteMeta) {
  return site.types.map((type) => (
    <span key={type} className="rounded bg-elevated px-1.5 py-px text-[10px] font-medium text-muted">
      {t(`type${type}` as "typeDYNAMIC")}
    </span>
  ));
}

function AddAccountModal({ defaultGroupId, onClose }: { defaultGroupId?: string; onClose: () => void }) {
  const { init, state } = useApp();
  const { toast } = useFeedback();
  const [site, setSite] = useState<SiteMeta | null>(null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [proxy, setProxy] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroupId ? [defaultGroupId] : []);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState<"all" | "International" | "CN">(
    init.locale === "zh_CN" ? "all" : "International",
  );
  const [type, setType] = useState<ContentType | "all">("all");

  const sites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return init.sites.filter(
      (s) =>
        (region === "all" || s.region === region || !!q) &&
        (type === "all" || s.types.includes(type)) &&
        (!q || s.label.toLowerCase().includes(q) || s.accountKey.includes(q) || s.homeUrl.includes(q)),
    );
  }, [init.sites, query, region, type]);

  const addedBySite = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of state.accounts) m.set(a.accountKey, (m.get(a.accountKey) ?? 0) + 1);
    return m;
  }, [state.accounts]);

  const chip = (active: boolean) =>
    cx(
      "h-7 rounded-full border px-3 text-xs font-medium transition",
      active
        ? "border-primary-500 bg-primary-50 text-primary-700 dark:text-primary-500"
        : "border-border text-muted hover:text-foreground",
    );

  const existingCount = site ? state.accounts.filter((a) => a.accountKey === site.accountKey).length : 0;

  const submit = async () => {
    if (!site) return;
    setBusy(true);
    try {
      const account = await api.createAccount({
        accountKey: site.accountKey,
        label: label.trim() || `${site.label}${existingCount ? ` ${existingCount + 1}` : ""}`,
        proxy,
        groupIds,
      });
      onClose();
      await api.loginAccount(account.id);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={site ? t("addAccount") : t("chooseSite")}
      onClose={onClose}
      width={site ? 520 : 760}
      footer={
        site ? (
          <>
            <Button onClick={() => setSite(null)}>{t("cancel")}</Button>
            <Button variant="primary" onClick={submit} disabled={busy} icon={<LogIn size={15} />}>
              {t("addAndSignIn")}
            </Button>
          </>
        ) : undefined
      }>
      {!site ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="field pl-8"
              autoFocus
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["International", "CN", "all"] as const).map((r) => (
              <button key={r} type="button" className={chip(region === r)} onClick={() => setRegion(r)}>
                {r === "all" ? t("filterAll") : r === "CN" ? t("regionCN") : t("regionIntl")}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {(["all", "DYNAMIC", "ARTICLE", "VIDEO", "PODCAST"] as const).map((x) => (
              <button key={x} type="button" className={chip(type === x)} onClick={() => setType(x)}>
                {x === "all" ? t("filterAnyType") : t(`type${x}` as "typeDYNAMIC")}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {sites.map((s) => (
              <button
                key={s.accountKey}
                type="button"
                onClick={() => setSite(s)}
                className="relative flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-2 py-3.5 text-center transition hover:border-primary-500 hover:bg-primary-50/40 focus-visible:border-primary-500 focus-visible:outline-none">
                <Favicon siteKey={s.accountKey} src={s.faviconUrl} label={s.label} size={36} />
                <span className="w-full truncate font-medium">{s.label}</span>
                <span className="flex flex-wrap justify-center gap-1">{typeChips(s)}</span>
                {addedBySite.get(s.accountKey) ? (
                  <span className="absolute right-2 top-2 rounded-full bg-success/10 px-1.5 text-[10px] font-medium text-success">
                    {t("addedCount", { n: addedBySite.get(s.accountKey) ?? 0 })}
                  </span>
                ) : null}
              </button>
            ))}
            {sites.length === 0 && <p className="col-span-4 py-8 text-center text-muted">{t("noSitesMatch")}</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-elevated/60 p-3">
            <Favicon siteKey={site.accountKey} src={site.faviconUrl} label={site.label} size={32} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold">{site.label}</span>
              <span className="flex flex-wrap gap-1">{typeChips(site)}</span>
            </div>
          </div>
          <Field label={t("accountLabel")} hint={t("accountLabelHint")}>
            <input
              className="field"
              autoFocus
              maxLength={80}
              placeholder={`${site.label}${existingCount ? ` ${existingCount + 1}` : ""}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </Field>
          {state.groups.length > 0 && (
            <Field label={t("memberOf")}>
              <GroupChips value={groupIds} onChange={setGroupIds} />
            </Field>
          )}
          <Field label={t("proxy")} hint={t("proxyHint")}>
            <input
              className="field font-mono text-xs"
              placeholder="socks5://127.0.0.1:1080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function GroupChips({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { state } = useApp();
  return (
    <div className="flex flex-wrap gap-1.5">
      {state.groups.map((g) => {
        const on = value.includes(g.id);
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition",
              on
                ? "border-primary-500 bg-primary-50 text-primary-700 dark:text-primary-500"
                : "border-border hover:bg-elevated",
            )}>
            <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
            {g.name}
            {on && <Check size={12} />}
          </button>
        );
      })}
    </div>
  );
}

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

function EditAccountModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { state, sitesByKey } = useApp();
  const { toast } = useFeedback();
  const site = sitesByKey.get(account.accountKey);
  const [label, setLabel] = useState(account.label);
  const [proxy, setProxy] = useState(account.proxy ?? "");
  const [userAgent, setUserAgent] = useState(account.userAgent ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const [timezone, setTimezone] = useState(account.timezone ?? "");
  const [locale, setLocale] = useState(account.locale ?? "");
  const [detecting, setDetecting] = useState(false);

  const matchProxy = async () => {
    setDetecting(true);
    try {
      await api.updateAccount(account.id, { proxy: proxy.trim() || undefined });
      const r = await api.detectRegion(account.id);
      setTimezone(r.timezone);
      setLocale(r.locale);
      toast(t("regionDetected", r), "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setDetecting(false);
    }
  };
  const [extra, setExtra] = useState(account.extraConfig ? JSON.stringify(account.extraConfig, null, 2) : "");
  const [groupIds, setGroupIds] = useState(
    state.groups.filter((g) => g.accountIds.includes(account.id)).map((g) => g.id),
  );
  const [advanced, setAdvanced] = useState(!!(account.userAgent || account.extraConfig));

  const save = async () => {
    let extraConfig: Record<string, unknown> | undefined;
    if (extra.trim()) {
      try {
        extraConfig = JSON.parse(extra);
      } catch {
        toast(t("invalidJson"), "error");
        return;
      }
    }
    try {
      await api.updateAccount(account.id, {
        label,
        proxy: proxy.trim() || undefined,
        userAgent: userAgent.trim() || undefined,
        notes,
        extraConfig,
        timezone: timezone.trim() || undefined,
        locale: locale.trim() || undefined,
      });
      await api.setAccountGroups(account.id, groupIds);
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <Modal
      open
      title={
        <span className="flex items-center gap-2">
          <Favicon src={site?.faviconUrl} siteKey={site?.accountKey} label={site?.label ?? ""} size={20} />
          {account.label}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={save}>
            {t("save")}
          </Button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <Field label={t("accountLabel")}>
          <input className="field" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {state.groups.length > 0 && (
          <Field label={t("memberOf")}>
            <GroupChips value={groupIds} onChange={setGroupIds} />
          </Field>
        )}
        <Field label={t("proxy")} hint={t("proxyHint")}>
          <input
            className="field font-mono text-xs"
            placeholder="socks5://127.0.0.1:1080"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("timezone")} hint={t("timezoneHint")}>
            <input
              className="field font-mono text-xs"
              list="mp-timezones"
              placeholder="America/New_York"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>
          <Field label={t("locale")} hint={t("localeHint")}>
            <input
              className="field font-mono text-xs"
              placeholder="en-US"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            />
          </Field>
        </div>
        <datalist id="mp-timezones">
          {timezones().map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={matchProxy} disabled={detecting} icon={<Globe size={13} />}>
            {t("matchProxy")}
          </Button>
          <span className="text-[11px] text-muted">{t("matchProxyHint")}</span>
        </div>
        <Field label={t("notes")}>
          <textarea className="field min-h-[60px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button
          type="button"
          className="self-start text-xs font-medium text-primary-600"
          onClick={() => setAdvanced(!advanced)}>
          {t("advanced")} {advanced ? "▾" : "▸"}
        </button>
        {advanced && (
          <>
            <Field label={t("userAgent")} hint={t("userAgentHint")}>
              <input
                className="field font-mono text-xs"
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
              />
            </Field>
            <Field label={t("extraConfig")} hint={t("extraConfigHint")}>
              <textarea
                className="field min-h-[90px] resize-y font-mono text-xs"
                spellCheck={false}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function GroupMembersModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { state, sitesByKey } = useApp();
  const [selected, setSelected] = useState<string[]>(group.accountIds);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = state.accounts.filter(
    (a) =>
      !q || a.label.toLowerCase().includes(q) || (sitesByKey.get(a.accountKey)?.label ?? "").toLowerCase().includes(q),
  );

  return (
    <Modal
      open
      title={`${t("manageMembers")} · ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await api.updateGroup(group.id, { accountIds: selected });
              onClose();
            }}>
            {t("save")}
          </Button>
        </>
      }>
      <div className="flex flex-col gap-3">
        <input className="field" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {list.map((a) => {
            const site = sitesByKey.get(a.accountKey);
            const on = selected.includes(a.id);
            return (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-elevated/50">
                <Checkbox
                  checked={on}
                  onChange={(v) => setSelected(v ? [...selected, a.id] : selected.filter((x) => x !== a.id))}
                />
                <Favicon src={site?.faviconUrl} siteKey={site?.accountKey} label={site?.label ?? ""} size={20} />
                <span className="flex-1 truncate">{a.label}</span>
                <span className="text-xs text-muted">{site?.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
