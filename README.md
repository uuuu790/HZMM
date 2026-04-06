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

- **One-click mod install** — Drag & drop `.zip`, `.rar`, or `.pak` files to install mods instantly
- **PAK & UE4SS support** — Manage both resource mods (PAK) and script mods (UE4SS Lua/C++)
- **UE4SS engine management** — Auto-deploy and update the UE4SS scripting framework
- **Mod conflict detection** — Scans PAK file indexes to detect resource-level conflicts between mods
- **Mod config editor** — Edit mod configuration files (`.ini`, `.lua`, `.json`, etc.) in-app
- **Profile system** — Save and switch between mod configurations with one click
- **Auto-update** — Checks GitHub for new releases and lets you download & install updates
- **Game detection** — Auto-detects HumanitZ install path via Steam registry
- **Game running alert** — Warns you before modifying files while the game is running
- **Multi-language** — Supports 7 languages: 繁體中文, English, 日本語, 한국어, Русский, Deutsch, Français
- **Dark / Light mode** — Toggle between day and night themes
- **Logging** — All operations logged to `%APPDATA%/hzmm-manager/hzmm.log`

## Screenshots

| Dashboard | Modules | Settings |
|-----------|---------|----------|
| ![Dashboard](docs/screenshots/screenshot-dashboard.png) | ![Modules](docs/screenshots/screenshot-modules.png) | ![Settings](docs/screenshots/screenshot-settings.png) |

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
│   │   ├── mods.js         # Mod scan, install, toggle, remove, config, cache
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

## License

All rights reserved.
