# MultiPost Desktop

A Windows desktop app (Electron) for publishing to many social media accounts at once. It reuses the browser extension's platform integrations (`../src/sync`) unchanged, so every platform the extension supports works here too.

## What it does

- **Many accounts per site.** Every account gets its own persistent Chromium profile, so cookies, logins and storage never mix. Ten X accounts can sit next to ten Bilibili accounts.
- **Groups.** Put accounts into groups such as "International", "China" or "Launch day", then select a whole group in the composer with one click. An account can belong to several groups.
- **Local only.** Accounts, groups, history and sign-ins stay on this computer, under `%APPDATA%\MultiPost Desktop`.
- **One composer, four content types.** Post (text + images/videos), Article (Markdown), Video and Podcast.
- **Parallel publishing.** Each target opens its publish page in that account's own browser window and fills it in. With **Auto-submit** on, the app also presses the platform's publish button. With it off, you review each window and publish yourself.
- **Honest results.** The Activity page shows each target's status, live. It reports failures when a page crashes, hangs, or redirects to a login page, and those accounts are marked as signed out. You can retry a single target or every failed one.
- **Looks like Chrome.** The app sends a standard Chrome user agent and Chrome client hints, and each account can use its own proxy (`http://user:pass@host:port`, `socks5://host:port`).

## Install (Windows 10/11, 64-bit)

Download from the repository's **Releases** page (tags `desktop-v*`):

| File | Use |
| --- | --- |
| `MultiPost-Desktop-Setup-<version>-x64.exe` | Installer (recommended) |
| `MultiPost-Desktop-<version>-x64-portable.exe` | Portable, no install |
| `MultiPost-Desktop-<version>-win-x64.zip` | Unpacked app |

The app is not code-signed yet. If SmartScreen warns you, choose **More info → Run anyway**.

## Using it

1. **Accounts → Add account.** Pick a site (filter by region or content type), name the account, and optionally add it to groups or set a proxy. A browser window opens. Sign in there, then close it.
2. **Check sign-in status** confirms the login for sites that support automatic checks. On other sites the status stays "Not checked" until you publish.
3. **Compose.** Choose a content type, write, and attach media (drag and drop works). On the right, select accounts or whole groups, then click **Publish**.
4. **Activity.** Follow each target. Use **Show** to bring a publish window to the front, and **Retry** for anything that failed.

Settings let you change how many pages publish in parallel, the limit on open windows, page timeouts, window visibility, language (English / 简体中文) and theme. You can also export and import a backup there. Backups contain accounts and groups, not cookies, so on a new computer you sign in again.

## Development

```bash
cd desktop
npm ci
npm run dev          # build + launch
npm run typecheck
npm run e2e          # end-to-end tests (Linux: xvfb-run -a npm run e2e; needs `npm i --no-save playwright`)
npm run dist:win     # Windows x64 installer, portable exe and zip into release/
```

How it is put together:

- `src/main/platforms.ts` imports the extension's `DynamicInfoMap`, `ArticleInfoMap`, `VideoInfoMap` and `PodcastInfoMap`. `i18n-shim.ts` provides `chrome.i18n` for them.
- `src/main/publisher.ts` runs the job queue. For each job it opens a window in the account's session, loads `injectUrl`, and runs `injectFunction` in an isolated world, the same way `chrome.scripting.executeScript` does in the extension. A watchdog fails the job on crashes, hangs and login redirects.
- `src/main/sessions.ts` sets up each account's session: Chrome identity, proxy, permissions, and the `multipost-file://` scheme that serves attached files to pages without being blocked by their CSP.
- `src/main/accounts.ts` handles login windows and account detection. Detection runs the extension's `src/sync/account/*` getters inside the account's session.
- `src/preload/page-preload.ts` replays the extension's MAIN-world helper script (`src/contents/helper.ts`) and aligns `navigator.userAgentData` with Chrome.
- `src/renderer/` is the UI (React + Tailwind).

To add a platform, add it to the extension as described in the root `CLAUDE.md`. The desktop app picks it up automatically.

## Releases

`.github/workflows/desktop.yml` runs the type check and the end-to-end suite on Linux, then builds the Windows x64 artifacts on `windows-latest` for every change to the app. To publish a GitHub release, do either of these:

- Push a tag: `git tag desktop-v1.0.0 && git push origin desktop-v1.0.0`
- Run the workflow manually (**Actions → Desktop (Windows x64) → Run workflow**). It creates the tag `desktop-v<version from package.json>`.
