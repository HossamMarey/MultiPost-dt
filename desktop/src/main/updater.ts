// Updates from GitHub Releases (installer builds only). Platform pages change often, and fixes to the
// inject functions only reach users through new releases.
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

export function startAutoUpdates() {
  // Portable and zip builds can't update themselves; electron-builder sets PORTABLE_EXECUTABLE_DIR for portable.
  if (!app.isPackaged || process.platform !== "win32" || process.env.PORTABLE_EXECUTABLE_DIR) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => console.warn("[updater]", error?.message ?? error));
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `MultiPost Desktop ${info.version} is ready to install.`,
      detail: "It will also be installed automatically the next time you quit.",
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}
