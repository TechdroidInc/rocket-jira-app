# Rocket Jira (Rocket.Chat App)

A Rocket.Chat App that rewrites Jira issue keys in messages into markdown links with the issue summary — **before** the message is sent, so it works in every room type: public channels, private groups, threads and direct messages (including DMs the app user is not part of).

Example: a message containing `SUPPORT-123` is sent as `[SUPPORT-123 (Login page crashes on IE11…)](https://jira.example.ch/browse/SUPPORT-123)`.

## Why an App?

Rocket.Chat 7.0+ does not allow external bots to read or write messages in rooms they are not members of (`error-not-allowed`, enforced via `canAccessRoom` on both `chat.update` and `chat.postMessage`). The only exemption is the `app` user type — which is exactly what this App runs as. This app complements/replaces the `rocket-jira` webhook bot (see `../rocket-jira`) for DMs.

## How it works

The app implements the `IPreMessageSentModify` hook, which runs on every message sent, in every room. It:

1. Skips system messages, edited messages, non-user senders, ignored users and messages without a matching issue key.
2. Looks up each issue summary in Jira (`GET /rest/api/2/issue/{key}?fields=summary`), cached in memory for 10 minutes.
3. Replaces each key with a markdown link before the message is saved.

Because the rewrite happens pre-save, there is **no "edited" marker** on the rewritten message.

All sensitive data is configured via app settings (Admin → Apps → Rocket Jira → Settings) and never ships with the app.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Jira base URL | — (required) | e.g. `https://jira.example.ch` |
| Jira username | — (required) | needs "Browse Projects" permission |
| Jira token | — (required) | personal access token (recommended) or API token; stored as password field |
| Jira auth mode | `Bearer token (pat)` | `pat` = `Authorization: Bearer`, `basic` = Basic auth |
| Issue key pattern | `\b[A-Z][A-Z0-9]{1,20}-\d+\b` | regex for issue keys |
| Project key allowlist | empty | comma-separated, e.g. `SUPPORT,SERVER`; empty = all |
| Maximum summary length | `40` | chars shown in the link text |
| Ignored usernames | empty | comma-separated usernames never rewritten |

## Development

```sh
npm install
npm run typecheck     # tsc --noEmit
npm run package       # rc-apps package -> dist/rocket-jira_0.1.0.zip (compiled)
```

For marketplace submission (source code):

```sh
npx rc-apps package --no-compile
```

## Installation

Rocket.Chat 7.0+ restricts **private app** installation to paid plans (verified: CE installs private apps as `Disabled` and cannot enable them — `privateApps` license limit is 0). Free marketplace apps run on Community workspaces (limit 5). So:

- **Development/testing**: use a licensed test instance (EE trial key on a throwaway Docker deployment), or a pre-7.0 local instance:
  ```sh
  npx rc-apps deploy --url https://your-server --username admin --password '...'
  ```
- **Production (Community)**: publish the app to the [marketplace](https://developer.rocket.chat/docs/app-submission-to-the-marketplace) (free publisher account, source code review) and install it from the marketplace on the workspace.
- **Production (licensed)**: upload the compiled zip in Admin → Marketplace → Private Apps.

After installation, configure the settings and the app starts rewriting immediately.

## Notes

- If the `rocket-jira` webhook bot is also running, no conflict occurs (the app rewrites pre-save; the bot then sees no raw keys) — but you can disable the bot once the app is active.
- Jira summaries may be stale for up to 10 minutes after an issue rename.
- The app declares the `networking` permission (any domain) because the Jira URL is a runtime setting.
