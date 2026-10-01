import { CheckCircle2, Clock, Eye, Loader2, RotateCcw, Send, Square, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { JobStatus, PublishJob } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../context";
import { t, timeAgo } from "../i18n";
import { Button, EmptyState, Favicon, IconButton, cx, useFeedback } from "./ui";

const ACTIVE: JobStatus[] = ["queued", "loading", "injecting"];

function StatusPill({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    queued: { label: t("jobQueued"), cls: "bg-elevated text-muted", icon: <Clock size={12} /> },
    loading: {
      label: t("jobLoading"),
      cls: "bg-primary-50 text-primary-700 dark:text-primary-500",
      icon: <Loader2 size={12} className="animate-spin" />,
    },
    injecting: {
      label: t("jobInjecting"),
      cls: "bg-primary-50 text-primary-700 dark:text-primary-500",
      icon: <Loader2 size={12} className="animate-spin" />,
    },
    done: { label: t("jobDone"), cls: "bg-success/10 text-success", icon: <CheckCircle2 size={12} /> },
    failed: { label: t("jobFailed"), cls: "bg-danger/10 text-danger", icon: <XCircle size={12} /> },
    cancelled: { label: t("jobCancelled"), cls: "bg-elevated text-muted", icon: <Square size={11} /> },
  };
  const s = map[status];
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
        s.cls,
      )}>
      {s.icon}
      {s.label}
    </span>
  );
}

export function ActivityView() {
  const { state, sitesByKey } = useApp();
  const { toast } = useFeedback();
  const [retryable, setRetryable] = useState<Set<string>>(new Set());

  const runs = useMemo(() => [...state.runs].reverse(), [state.runs]);
  const jobsById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs]);
  const jobIdsKey = state.jobs.map((j) => j.id).join(",");

  useEffect(() => {
    api.retryableJobs(state.jobs.map((j) => j.id)).then((ids: string[]) => setRetryable(new Set(ids)));
  }, [jobIdsKey]);

  const act = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errorMessage(e), "error"));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface/60 px-6 py-4">
        <h1 className="text-lg font-semibold">{t("navActivity")}</h1>
        <div className="flex-1" />
        {runs.length > 0 && (
          <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => act(() => api.clearHistory())}>
            {t("clearHistory")}
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {runs.length === 0 ? (
          <EmptyState icon={<Send size={22} />} title={t("activityEmptyTitle")} body={t("activityEmptyBody")} />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {runs.map((run) => {
              const jobs = run.jobIds.map((id) => jobsById.get(id)).filter(Boolean) as PublishJob[];
              const done = jobs.filter((j) => j.status === "done").length;
              const failed = jobs.filter((j) => j.status === "failed").length;
              const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
              const failedRetryable = jobs.filter(
                (j) => (j.status === "failed" || j.status === "cancelled") && retryable.has(j.id),
              );
              const pct = jobs.length ? Math.round(((jobs.length - active) / jobs.length) * 100) : 100;
              return (
                <section
                  key={run.id}
                  className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{run.title}</div>
                      <div className="flex gap-2 text-xs text-muted">
                        <span>{t(`type${run.contentType}` as "typeDYNAMIC")}</span>
                        <span>·</span>
                        <span>{timeAgo(run.createdAt)}</span>
                        <span>·</span>
                        <span className="text-success">{t("doneCount", { n: done })}</span>
                        {failed > 0 && <span className="text-danger">{t("failedCount", { n: failed })}</span>}
                        {active > 0 && <span className="text-primary-600">{t("running", { n: active })}</span>}
                      </div>
                    </div>
                    {failedRetryable.length > 0 && (
                      <Button
                        size="sm"
                        icon={<RotateCcw size={13} />}
                        onClick={() => failedRetryable.forEach((j) => act(() => api.retryJob(j.id)))}>
                        {t("retryFailed")}
                      </Button>
                    )}
                  </div>
                  {active > 0 && (
                    <div className="h-0.5 bg-elevated">
                      <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <ul className="divide-y divide-border border-t border-border">
                    {jobs.map((job) => {
                      const account = state.accounts.find((a) => a.id === job.accountId);
                      const site = account ? sitesByKey.get(account.accountKey) : undefined;
                      const isActive = ACTIVE.includes(job.status);
                      return (
                        <li key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                          <Favicon src={site?.faviconUrl} label={job.platformName} size={20} />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">
                              <span className="font-medium">{account?.label ?? job.accountLabel}</span>
                              <span className="text-muted"> · {job.platformName}</span>
                            </span>
                            {job.error && job.status !== "done" && (
                              <span className="truncate text-xs text-danger" title={job.error}>
                                {job.error}
                              </span>
                            )}
                          </div>
                          <StatusPill status={job.status} />
                          <div className="flex w-[100px] justify-end gap-0.5">
                            {(isActive || job.status === "done") && (
                              <IconButton label={t("show")} onClick={() => act(() => api.showJob(job.id))}>
                                <Eye size={15} />
                              </IconButton>
                            )}
                            {isActive && (
                              <IconButton label={t("stop")} onClick={() => act(() => api.cancelJob(job.id))}>
                                <Square size={13} />
                              </IconButton>
                            )}
                            {!isActive && retryable.has(job.id) && (
                              <IconButton label={t("retry")} onClick={() => act(() => api.retryJob(job.id))}>
                                <RotateCcw size={14} />
                              </IconButton>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
