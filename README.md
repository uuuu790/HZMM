<p align="center">
  <img src="resources/icon.png" width="120" alt="HZMM Logo">
</p>

<h1 align="center">HZMM Manager</h1>

<p align="center">
  <strong>HumanitZ Mod Manager</strong> — A modern desktop app for managing HumanitZ game mods.
</p>

<p align="center">
  <a href="https://github.com/uuuu790/HZMM/releases/latest">
    <img src="https://img.shields.io/github/v/release/uuuu790/HZMM?style=flat-square" alt="Latest Release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-33-47848F?style=flat-square&logo=electron" alt="Electron">
</p>

---

## Features

### Mod Management
- **One-click install** — Drag & drop `.zip`, `.rar`, or `.pak` files to install mods instantly
- **PAK & UE4SS support** — Manage both resource mods (PAK) and script mods (UE4SS Lua/C++)
- **Inline rename** — Click any mod name to give it a custom display name
- **Mod config editor** — Visual editor for mod configs with auto-detected toggles, selectors, and inputs
- **Multi-language configs** — Config descriptions and options follow the app language ([standard](docs/CONFIG.md))
- **Mod conflict detection** — Scans PAK file indexes to detect resource-level conflicts between mods
- **Profile system** — Save and switch between mod configurations with one click

### Engine & Game
- **UE4SS engine management** — Auto-deploy and update the UE4SS scripting framework
- **Game detection** — Auto-detects HumanitZ install path via Steam registry
- **Game running alert** — Warns you before modifying files while the game is running

### Backup & Update
- **World save backup** — Backup world saves with mod snapshot, restore anytime
- **Auto-update** — Checks GitHub for new releases, downloads and replaces in-place

### User Experience
- **Multi-language** — 繁體中文, English, 日本語, 한국어, Русский, Deutsch, Français
- **6 theme presets** — Ember, Crimson, Toxic, Frost, Violet, Gold with Dark / Light mode
- **Logging** — All operations logged to `%APPDATA%/hzmm-manager/hzmm.log`

## Screenshots

| Dashboard | Library |
|:---------:|:-------:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Library](docs/screenshots/library.png) |

| Profiles | Settings |
|:--------:|:--------:|
| ![Profiles](docs/screenshots/profiles.png) | ![Settings](docs/screenshots/settings.png) |

## Download

Download the latest portable `.exe` from [Releases](https://github.com/uuuu790/HZMM/releases/latest). No installation required — just run it.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Electron](https://www.electronjs.org/) 33 |
| Frontend | [React](https://react.dev/) 18 + [Tailwind CSS](https://tailwindcss.com/) 4 |
| Build | [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/) |
| Archive | [node-stream-zip](https://github.com/nicow22/node-stream-zip) + [node-unrar-js](https://github.com/nicow22/node-unrar-js) |
| Icons | [Lucide React](https://lucide.dev/) |

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.js            # App entry, window creation, IPC registration
│   ├── ipc/                # IPC handlers
│   │   ├── mods.js         # Mod IPC registration, config, custom names
│   │   ├── mods-scan.js    # Mod scanning with in-memory cache
│   │   ├── mods-install.js # Archive extraction & mod installation
│   │   ├── mods-registry.js # UE4SS mods.txt / mods.json registry
│   │   ├── mods-download.js # URL download & Nexus Mods API
│   │   ├── game.js         # Game path detection, launch, running check
│   │   ├── ue4ss.js        # UE4SS engine deploy & update
│   │   ├── settings.js     # Settings, file dialogs, shell commands
│   │   ├── locale.js       # Multi-language support
│   │   ├── app-update.js   # Auto-update check, download, install
│   │   └── conflicts.js    # Mod conflict detection
│   └── services/           # Business logic
│       ├── archive.js      # ZIP/RAR extraction, mod type analysis
│       ├── config-store.js # JSON config persistence
│       ├── steam-detector.js # Steam path & game detection
│       ├── github-release.js # UE4SS GitHub release fetcher
│       ├── app-updater.js  # App update checker & downloader
│       ├── pak-parser.js   # UE4 PAK binary index reader
│       ├── process-detector.js # Game process detection
│       └── logger.js       # File logger with rotation
├── preload/
│   └── index.js            # Context bridge (API exposure to renderer)
└── renderer/
    └── src/
        ├── App.jsx         # Main UI component
        ├── main.jsx        # React entry point
        └── index.css       # Global styles

tests/
├── services/               # Unit tests for main/services
│   ├── path-safety.test.js     # isPathWithin / resolveWithin — zip-slip & traversal
│   ├── archive.test.js         # isSafePath, analyzeArchiveStructure
│   └── app-updater.test.js     # compareVersions, version parsing
├── ipc/                    # Unit tests for main/ipc pure helpers
│   ├── mods-config-path.test.js   # resolveModConfigPath — modFilename traversal
│   ├── mods-download.test.js      # parseNexusUrl, URL validation
│   ├── mods-install.test.js       # findUe4ssFolders, mod type detection
│   └── mods-registry.test.js      # mods.txt / mods.json sync & removal
└── renderer/
    └── i18n-completeness.test.js  # All 7 languages have matching keys

e2e/                        # Playwright E2E tests (Electron)
├── drag-drop.spec.mjs      # Drag & drop synthetic events
└── visual-regression.spec.mjs # Screenshot comparison (light & dark mode)
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+

### Setup

```bash
git clone https://github.com/uuuu790/HZMM.git
cd HZMM
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build portable exe

```bash
npm run package
```

Output: `dist/HZMM Manager {version}.exe`

### Testing

204 unit tests (Vitest) + 16 E2E tests (Playwright).

```bash
npm run test          # unit tests (one-shot)
npm run test:watch    # unit tests (watch mode)
npx playwright test   # E2E tests (requires built Electron app)
```

Unit tests live in `tests/` and target pure helpers. E2E tests live in `e2e/` and launch the real Electron app. Any new IPC handler that builds a filesystem path from renderer input **must** use `resolveWithin` from `services/path-safety.js` and ship with a traversal test.

### Linting

```bash
npm run lint          # report
npm run lint:fix      # auto-fix safe rules
```

Main process and preload code run under Node/Electron rules via `eslint-plugin-n`. Renderer runs under `eslint-plugin-react` + `react-hooks`. A custom rule bans `child_process.exec` with template literals — use `spawn` with an argv array instead.

## License

All rights reserved.
