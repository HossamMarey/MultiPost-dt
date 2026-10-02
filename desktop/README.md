# MultiPost Desktop

A Windows desktop app (Electron) for publishing to many social media accounts at once. It reuses the browser extension's platform integrations (`../src/sync`) unchanged, so every platform the extension supports works here too.

## What it does

- **Many accounts per site.** Every account gets its own persistent Chromium profile, so cookies, logins and storage never mix. Ten X accounts can sit next to ten Bilibili accounts.
- **Groups.** Put accounts into groups such as "International", "China" or "Launch day", then select a whole group in the composer with one click. An account can belong to several groups.
- **Local only.** Accounts, groups, history and sign-ins stay on this computer, under `%APPDATA%\MultiPost Desktop`.
- **One composer, four content types.** Post (text + images/videos), Article (Markdown), Video and Podcast. Facebook, Instagram (as a Reel), X, LinkedIn, Threads and Reddit appear under Video too; their video goes through the site's own post page.
- **Parallel publishing.** Each target opens its publish page in that account's own browser window and fills it in. With **Auto-submit** on, the app also presses the platform's publish button. With it off, you review each window and publish yourself.
- **Honest results.** The Activity page shows each target's status, live. It reports failures when a page crashes, hangs, or redirects to a login page, and those accounts are marked as signed out. You can retry a single target or every failed one.
- **Looks like Chrome.** The app sends a standard Chrome user agent and Chrome client hints, and each account can use its own proxy (`http://user:pass@host:port`, `socks5://host:port`).
- **Confirmed results.** The app reads each platform's own answer to the publish click.
  - When the platform confirms the post, the job shows **Published** with a **View post** link.
  - When the platform refuses it, the job shows **Rejected** with the platform's reason, for example "duplicate".
  - When nothing recognizable comes back, it shows **Not confirmed**.
  - Built-in rules cover X, YouTube, TikTok, Douyin, Bilibili, Weibo, Xiaohongshu, Instagram, Threads, Facebook, LinkedIn, Bluesky, Kuaishou, Zhihu and WeChat Channels. Other platforms are judged by heuristics and show as **Probably published**.
- **Check targets before publishing.** Each selected publish page opens hidden, and the app reports for each target whether the account is signed in, the page loads, and the editor is still there.
- **Different text per platform and per account.** Override the title, text and tags per platform, or for a single account.
  - Groups can add a footer and hashtags automatically.
  - Text can use `{account}`, `{site}`, `{date}` and `{time}`.
  - An optional setting changes the hashtag order for each account.
  - A preview shows exactly what each account will publish.
- **Live limit checks.** The composer checks each platform's limits as you type: character counts (X 280, Threads 500, Bluesky 300 and so on), title lengths, tag limits, image counts, required media, video length, vertical video and cover ratio.
- **AI rewrite (optional).** Adapts the post to each platform's style and limits with Claude. To use it, add your Anthropic API key in Settings. The key is stored encrypted, and only the post's title, text and tags are sent, and only when you click **Rewrite**.
- **Location per account.** Set a timezone and language for each account, or click **Match proxy location**, which looks up the proxy's location through ipwho.is. Pages and the `Accept-Language` header then match the proxy.
- **Automatic retry.** If a page fails to load because of a network error, the app tries again after 20 s and again after 60 s. Nothing has been submitted at that point, so a retry can't post twice.

## Install (Windows 10/11, 64-bit)

Download from the repository's **Releases** page (tags `desktop-v*`):

| File | Use |
| --- | --- |
| `MultiPost-Desktop-Setup-<version>-x64.exe` | Installer (recommended) |
| `MultiPost-Desktop-<version>-x64-portable.exe` | Portable, no install |
| `MultiPost-Desktop-<version>-win-x64.zip` | Unpacked app |

Unless the release was built with a signing certificate (see below), the app isn't code-signed. If SmartScreen warns you, choose **More info → Run anyway**.

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
npm run test:unit    # rules and per-target text resolution
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

### Code signing

To sign the installer, the portable exe and auto-updates, add two repository secrets:

- `WIN_CSC_LINK`: your `.pfx` Authenticode certificate, base64-encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`)
- `WIN_CSC_KEY_PASSWORD`: the certificate's password

The workflow then signs automatically. Without the secrets, builds are unsigned. An EV or OV certificate removes the SmartScreen warning; an EV certificate does so immediately.
