import { Download, FolderOpen, Upload } from "lucide-react";
import type { ReactNode } from "react";
import type { Settings } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../context";
import { t } from "../i18n";
import { Button, Toggle, cx, useFeedback } from "./ui";

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface shadow-card">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg bg-elevated p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "h-7 rounded-md px-3 text-xs font-medium",
            value === o.value ? "bg-surface shadow-card" : "text-muted hover:text-foreground",
          )}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView() {
  const { state, init } = useApp();
  const { toast } = useFeedback();
  const s = state.settings;
  const set = (patch: Partial<Settings>) => api.updateSettings(patch).catch((e) => toast(errorMessage(e), "error"));
  const siteCount = init.sites.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-6">
        <h1 className="text-lg font-semibold">{t("navSettings")}</h1>

        <Card title={t("settingsPublishing")}>
          <Row title={t("concurrency")} hint={t("concurrencyHint")}>
            <input
              type="number"
              min={1}
              max={10}
              className="field w-20 text-center"
              value={s.concurrency}
              onChange={(e) => set({ concurrency: Number(e.target.value) })}
            />
          </Row>
          <Row title={t("pageTimeout")}>
            <input
              type="number"
              min={10}
              max={300}
              className="field w-20 text-center"
              value={s.pageTimeoutSec}
              onChange={(e) => set({ pageTimeoutSec: Number(e.target.value) })}
            />
          </Row>
          <Row title={t("showWindows")} hint={t("showWindowsHint")}>
            <Toggle checked={s.showPublishWindows} onChange={(v) => set({ showPublishWindows: v })} />
          </Row>
          <Row title={t("defaultAutoPublish")} hint={t("autoPublishHint")}>
            <Toggle checked={s.autoPublish} onChange={(v) => set({ autoPublish: v })} />
          </Row>
          <Row title={t("closeOnSuccess")}>
            <Toggle checked={s.closeWindowsOnSuccess} onChange={(v) => set({ closeWindowsOnSuccess: v })} />
          </Row>
        </Card>

        <Card title={t("settingsAppearance")}>
          <Row title={t("language")} hint={s.language !== init.locale ? t("languageRestart") : undefined}>
            <div className="flex items-center gap-2">
              {s.language !== init.locale && (
                <Button size="sm" variant="primary" onClick={() => api.relaunch()}>
                  {t("restart")}
                </Button>
              )}
              <Segmented
                value={s.language}
                options={[
                  { value: "en", label: "English" },
                  { value: "zh_CN", label: "简体中文" },
                ]}
                onChange={(language) => set({ language })}
              />
            </div>
          </Row>
          <Row title={t("theme")}>
            <Segmented
              value={s.theme}
              options={[
                { value: "system", label: t("themeSystem") },
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
              ]}
              onChange={(theme) => set({ theme })}
            />
          </Row>
        </Card>

        <Card title={t("settingsData")}>
          <Row title={t("dataHint")} hint={t("backupNote")}>
            <span />
          </Row>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <Button
              icon={<Download size={15} />}
              onClick={async () => {
                try {
                  if (await api.exportData()) toast(t("exported"), "success");
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}>
              {t("exportData")}
            </Button>
            <Button
              icon={<Upload size={15} />}
              onClick={async () => {
                try {
                  if (await api.importData()) toast(t("imported"), "success");
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}>
              {t("importData")}
            </Button>
            <Button icon={<FolderOpen size={15} />} onClick={() => api.openDataFolder()}>
              {t("openDataFolder")}
            </Button>
          </div>
        </Card>

        <Card title={t("about")}>
          <Row title="MultiPost Desktop" hint={t("platformsSupported", { n: init.platforms.length, s: siteCount })}>
            <span className="text-xs tabular-nums text-muted">
              {t("version")} {init.version}
            </span>
          </Row>
        </Card>
      </div>
    </div>
  );
}
