# zman

A desktop API client in the style of Postman that keeps everything on your computer. There is no
account, no sync, no telemetry and no update check: the only network traffic the app produces is
the requests you send yourself.

Runs on Linux (built for Ubuntu) and macOS. Built with Tauri 2 (Rust) and React.

## Features

- **Collections** with nested folders: create, rename, duplicate, delete, drag to reorder, filter.
- **Requests**: any HTTP method; query parameters kept in sync with the URL; `:name` path
  variables; headers; bodies as raw text (JSON, XML, HTML, JavaScript, plain text), form-data with
  text and file parts, x-www-form-urlencoded, a binary file, or GraphQL.
- **Authorization**: Basic, Bearer token and API key (header or query), set on a request or
  inherited from its folder or collection.
- **Variables**: `{{name}}` anywhere in the URL, headers, body and auth. Scopes, lowest to highest
  priority: globals, collection, active environment. Unresolved names are underlined in red.
  Built in: `{{$guid}}`, `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`.
- **Responses**: status, time and size; body as pretty-printed or raw text, or as a sandboxed HTML
  preview (scripts do not run); headers; cookies; copy or save to a file.
- **Tabs and history**: several requests open at once, unsaved-change markers, tabs restored on
  the next start, and the last 500 sent requests one click away.
- **Postman import**: collections in the v2.1 and v2.0 formats, environment files and globals
  files. Drop the files on the Import dialog, choose them, or paste the JSON.
- **Postman export**: a collection as a v2.1 file, an environment as a Postman environment file.
- **cURL**: copy any request as a cURL command; paste a cURL command into the URL field or the
  Import dialog to turn it into a request.
- **Settings**: request timeout, follow redirects, SSL certificate verification, proxy, light or
  dark theme.

### Not supported

- Pre-request and test scripts (`pm.*`) are not run. They are kept as imported and written back
  on export, and the Import dialog tells you which collections contain them.
- OAuth 2.0 and the other Postman auth types beyond Basic, Bearer and API key. They are also kept
  for export; requests that use them are sent without authorization.
- WebSocket, gRPC, the collection runner, mock servers and saved example responses.

## Install

The `Build` workflow in GitHub Actions builds the installers when a version tag is pushed
(`git tag v0.1.0 && git push origin v0.1.0`) and attaches them to that run as artifacts. Pushes
to `main` and pull requests only run the tests.

- **Ubuntu**: `sudo apt install ./zman_0.1.0_amd64.deb`, or make the `.AppImage` executable and
  run it. The `.deb` needs Ubuntu 22.04 or newer.
- **macOS** (13.3 or newer, Intel and Apple Silicon): open the `.dmg` and drag zman to
  Applications. The build is not signed with an Apple Developer ID, so macOS blocks the first
  launch. Open it once, dismiss the warning, then allow it under System Settings → Privacy &
  Security → Open Anyway. Alternatively: `xattr -dr com.apple.quarantine /Applications/zman.app`.

## Build from source

Requirements: Node 22 or newer, Rust (stable, from [rustup](https://rustup.rs)), and the system
libraries Tauri needs.

Ubuntu:

```bash
sudo apt update && sudo apt install -y build-essential cmake curl wget file pkg-config \
  libwebkit2gtk-4.1-dev libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
```

macOS: `xcode-select --install`.

Then:

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # installers in src-tauri/target/release/bundle/
```

If the AppImage step fails on a recent distribution while stripping libraries, run
`NO_STRIP=1 npm run tauri build`.

### Tests

```bash
npm test                                                        # TypeScript core (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml -p zman-core    # HTTP engine and storage
```

### Browser preview

`npm run dev` serves the interface at http://localhost:1420 without the Rust side. In that mode
data lives in the browser's `localStorage` and requests go through `fetch`, so they are subject
to CORS. It exists for working on the interface; use the desktop app for real work.

## Where your data is

| System | Folder |
| --- | --- |
| Linux | `~/.local/share/com.techiesolo.zman/` |
| macOS | `~/Library/Application Support/com.techiesolo.zman/` |

```
collections/<id>.json     one file per collection
environments/<id>.json    one file per environment
globals.json              global variables
history.json              the last 500 sent requests
state.json                open tabs, active environment, settings, layout
```

The files are plain JSON. To back up or move your data, copy the folder while the app is closed.
Settings shows the exact path.

**Variable values, tokens and passwords are stored as plain text** in these files, and sent
requests (including their headers) are kept in `history.json`. Cookies are kept in memory only
and are gone when the app closes.

## Keyboard shortcuts

Use Cmd instead of Ctrl on macOS.

| Shortcut | Action |
| --- | --- |
| Ctrl+Enter | Send the request |
| Ctrl+S | Save the request |
| Ctrl+T | New tab |
| Ctrl+W | Close the tab |

On macOS the system menu also binds Cmd+W to closing the window, and it may win over the app's
own handling. Use the × on the tab there if it does.

## How it is put together

```
src/model/        data model shared by everything
src/lib/          Postman import and export, cURL, variables, URL handling, request building
src/store/        application state (Zustand) and persistence
src/backend/      the interface to the native side, plus the browser stand-in
src/components/   the React interface
src-tauri/core/   Rust: HTTP engine (reqwest) and JSON file storage, no GUI dependencies
src-tauri/src/    Rust: Tauri commands and file dialogs
tests/            Vitest suites and Postman fixtures
```

Rust does only what a webview cannot: sending HTTP without CORS limits and reading and writing
files. The interface resolves variables and authorization itself and hands the Rust side a fully
built request. The webview's content security policy allows no remote origins, so the interface
cannot contact any server on its own.
