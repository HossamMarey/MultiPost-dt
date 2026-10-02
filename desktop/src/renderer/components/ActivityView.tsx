import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Loader2,
  RotateCcw,
  Send,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
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
    done: {
      label: t("jobDone"),
      cls: "bg-success/10 text-success",
      icon: <CheckCircle2 size={12} />,
    },
    attention: { label: t("jobAttention"), cls: "bg-warning/10 text-warning", icon: <AlertTriangle size={12} /> },
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
  const [openWindows, setOpenWindows] = useState<Set<string>>(new Set());

  const runs = useMemo(() => [...state.runs].reverse(), [state.runs]);
  const jobsById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs]);
  const jobIdsKey = state.jobs.map((j) => j.id).join(",");

  const statusKey = state.jobs.map((j) => j.status).join(",");
  useEffect(() => {
    api.retryableJobs(state.jobs.map((j) => j.id)).then((ids: string[]) => setRetryable(new Set(ids)));
  }, [jobIdsKey]);
  useEffect(() => {
    const refresh = () => api.openJobWindows().then((ids: string[]) => setOpenWindows(new Set(ids)));
    refresh();
    const timer = setInterval(refresh, 2000); // windows can be closed by the user at any time
    return () => clearInterval(timer);
  }, [statusKey]);

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
              const kinds = jobs.map(outcomeOf);
              const count = (k: Outcome) => kinds.filter((x) => x === k).length;
              const published = count("published");
              const unconfirmed = count("unconfirmed");
              const review = count("review");
              const failed = count("failed");
              const cancelled = count("cancelled");
              const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
              const failedRetryable = jobs.filter(
                (j) =>
                  (j.status === "failed" || j.status === "cancelled" || j.status === "attention") &&
                  retryable.has(j.id),
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
                        {published > 0 && <span className="text-success">{t("sumPublished", { n: published })}</span>}
                        {unconfirmed > 0 && (
                          <span className="text-warning">{t("sumUnconfirmed", { n: unconfirmed })}</span>
                        )}
                        {review > 0 && <span className="text-muted">{t("sumReview", { n: review })}</span>}
                        {failed > 0 && <span className="text-danger">{t("failedCount", { n: failed })}</span>}
                        {cancelled > 0 && <span className="text-muted">{t("sumCancelled", { n: cancelled })}</span>}
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
                          <Favicon
                            src={site?.faviconUrl}
                            siteKey={site?.accountKey}
                            label={job.platformName}
                            size={20}
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">
                              <span className="font-medium">{account?.label ?? job.accountLabel}</span>
                              <span className="text-muted"> · {job.platformName}</span>
                            </span>
                            {job.status === "done" && !job.autoPublish && job.verification !== "published" && (
                              <span className="truncate text-xs text-muted">{t("reviewHint")}</span>
                            )}
                            {job.status === "queued" && job.retryAt && <RetryCountdown at={job.retryAt} />}
                            {job.error && job.status !== "done" && (
                              <span
                                className={cx(
                                  "truncate text-xs",
                                  job.status === "failed"
                                    ? "text-danger"
                                    : job.status === "attention"
                                      ? "text-warning"
                                      : "text-muted",
                                )}
                                title={job.error}>
                                {job.error}
                              </span>
                            )}
                          </div>
                          {job.status === "done" ? <VerificationBadge job={job} /> : <StatusPill status={job.status} />}
                          {job.status === "failed" && /sign in/i.test(job.error ?? "") && (
                            <Button size="sm" onClick={() => act(() => api.loginAccount(job.accountId))}>
                              {t("signIn")}
                            </Button>
                          )}
                          <div className="flex w-[100px] justify-end gap-0.5">
                            {openWindows.has(job.id) && (
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

function RetryCountdown({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-xs text-muted">{t("retryingIn", { s: Math.max(0, Math.ceil((at - now) / 1000)) })}</span>
  );
}

type Outcome = "running" | "published" | "unconfirmed" | "review" | "attention" | "failed" | "cancelled";

/** One outcome per job, so a row never shows two contradicting states. */
function outcomeOf(job: PublishJob): Outcome {
  if (ACTIVE.includes(job.status)) return "running";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "attention") return "attention";
  if (job.verification === "published") return "published";
  if (!job.autoPublish) return "review";
  return "unconfirmed";
}

function VerificationBadge({ job }: { job: PublishJob }) {
  const v = job.verification;
  let label: string;
  let cls: string;
  let icon: React.ReactNode = null;
  let help: string | undefined;
  if (v === "published") {
    label = t("verif_published");
    cls = "bg-success/10 text-success";
    icon = <BadgeCheck size={12} />;
  } else if (v === "likely") {
    label = t("verif_likely");
    cls = "bg-warning/10 text-warning";
    icon = <CheckCircle2 size={12} />;
    help = t("verifHelp_likely");
  } else if (!job.autoPublish) {
    label = t("jobFilled");
    cls = "bg-elevated text-foreground/80";
    icon = <CheckCircle2 size={12} />;
  } else if (v === "pending") {
    label = t("verif_pending");
    cls = "bg-elevated text-muted";
    icon = <Loader2 size={12} className="animate-spin" />;
  } else {
    label = t("verif_unconfirmed");
    cls = "bg-warning/10 text-warning";
    icon = <AlertTriangle size={12} />;
    help = t("verifHelp_unconfirmed");
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {job.postUrl && (
        <button
          type="button"
          onClick={() => api.openExternal(job.postUrl!)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline">
          {t("viewPost")}
          <ExternalLink size={11} />
        </button>
      )}
      <span
        title={help}
        className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium", cls)}>
        {icon}
        {label}
      </span>
    </span>
  );
}
