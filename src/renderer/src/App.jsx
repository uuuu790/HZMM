import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Biohazard, CheckCircle, X, Settings, Terminal, Power, Package, AlertTriangle, DownloadCloud, RefreshCw, Play, Globe, Sun, Moon, ChevronDown, UploadCloud, Trash2, Plus, Save, Info, LayoutDashboard, Layers, Zap, Folder, FileText, Sliders, RotateCcw, ExternalLink } from 'lucide-react';

// ==========================================
// 1. 預設圖示對應表 (Icon Map for Local Mods)
// ==========================================

const MOD_ICONS = {
  PAK: { icon: Package, color: 'from-indigo-500/20 to-blue-500/20', accent: 'text-indigo-500', iconColor: 'text-indigo-500' },
  UE4SS: { icon: Terminal, color: 'from-rose-500/20 to-pink-500/20', accent: 'text-rose-500', iconColor: 'text-rose-500' },
  default: { icon: Package, color: 'from-slate-500/20 to-slate-600/20', accent: 'text-slate-500', iconColor: 'text-slate-500' }
};

function getModIcon(mod) {
  return MOD_ICONS[mod.type] || MOD_ICONS.default;
}

function cleanModName(name) {
  return name.replace(/\.(pak|zip|rar)(\.disabled)?$/i, '').replace(/_P$/, '').replace(/\s+P$/, '');
}

// ==========================================
// 2. 主題預設 (Theme Presets)
// ==========================================

const THEME_PRESETS = [
  {
    id: 'ember',
    accent: { 50:'#fff7ed',100:'#ffedd5',200:'#fed7aa',300:'#fdba74',400:'#fb923c',500:'#f97316',600:'#ea580c',700:'#c2410c',800:'#9a3412',900:'#7c2d12',rgb:'249,115,22' },
    gradient: { from:'#f97316', to:'#dc2626' },
    orbs: {
      light:['rgba(251,146,60,0.35)','rgba(232,121,249,0.30)','rgba(252,211,77,0.35)','rgba(251,113,133,0.30)'],
      dark:['rgba(185,28,28,0.25)','rgba(67,56,202,0.25)','rgba(154,52,18,0.30)','rgba(185,28,28,0.20)']
    }
  },
  {
    id: 'crimson',
    accent: { 50:'#fff1f2',100:'#ffe4e6',200:'#fecdd3',300:'#fda4af',400:'#fb7185',500:'#f43f5e',600:'#e11d48',700:'#be123c',800:'#9f1239',900:'#881337',rgb:'244,63,94' },
    gradient: { from:'#f43f5e', to:'#9f1239' },
    orbs: {
      light:['rgba(251,113,133,0.35)','rgba(244,63,94,0.25)','rgba(253,164,175,0.35)','rgba(190,18,60,0.20)'],
      dark:['rgba(159,18,57,0.30)','rgba(136,19,55,0.25)','rgba(190,18,60,0.25)','rgba(159,18,57,0.20)']
    }
  },
  {
    id: 'toxic',
    accent: { 50:'#f0fdf4',100:'#dcfce7',200:'#bbf7d0',300:'#86efac',400:'#4ade80',500:'#22c55e',600:'#16a34a',700:'#15803d',800:'#166534',900:'#14532d',rgb:'34,197,94' },
    gradient: { from:'#22c55e', to:'#15803d' },
    orbs: {
      light:['rgba(74,222,128,0.35)','rgba(163,230,53,0.30)','rgba(34,197,94,0.25)','rgba(132,204,22,0.30)'],
      dark:['rgba(21,128,61,0.30)','rgba(63,98,18,0.25)','rgba(20,83,45,0.25)','rgba(21,128,61,0.20)']
    }
  },
  {
    id: 'frost',
    accent: { 50:'#eff6ff',100:'#dbeafe',200:'#bfdbfe',300:'#93c5fd',400:'#60a5fa',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af',900:'#1e3a8a',rgb:'59,130,246' },
    gradient: { from:'#3b82f6', to:'#1d4ed8' },
    orbs: {
      light:['rgba(96,165,250,0.35)','rgba(56,189,248,0.30)','rgba(147,197,253,0.30)','rgba(99,102,241,0.25)'],
      dark:['rgba(30,64,175,0.30)','rgba(29,78,216,0.25)','rgba(30,58,138,0.25)','rgba(55,48,163,0.20)']
    }
  },
  {
    id: 'violet',
    accent: { 50:'#faf5ff',100:'#f3e8ff',200:'#e9d5ff',300:'#d8b4fe',400:'#c084fc',500:'#a855f7',600:'#9333ea',700:'#7e22ce',800:'#6b21a8',900:'#581c87',rgb:'168,85,247' },
    gradient: { from:'#a855f7', to:'#7e22ce' },
    orbs: {
      light:['rgba(192,132,252,0.35)','rgba(217,70,239,0.25)','rgba(168,85,247,0.30)','rgba(139,92,246,0.25)'],
      dark:['rgba(107,33,168,0.30)','rgba(126,34,206,0.25)','rgba(88,28,135,0.25)','rgba(91,33,182,0.20)']
    }
  },
  {
    id: 'gold',
    accent: { 50:'#fffbeb',100:'#fef3c7',200:'#fde68a',300:'#fcd34d',400:'#fbbf24',500:'#f59e0b',600:'#d97706',700:'#b45309',800:'#92400e',900:'#78350f',rgb:'245,158,11' },
    gradient: { from:'#f59e0b', to:'#b45309' },
    orbs: {
      light:['rgba(251,191,36,0.35)','rgba(252,211,77,0.30)','rgba(245,158,11,0.30)','rgba(253,224,71,0.25)'],
      dark:['rgba(146,64,14,0.30)','rgba(180,83,9,0.25)','rgba(120,53,15,0.25)','rgba(146,64,14,0.20)']
    }
  }
];

function getTheme(id) {
  return THEME_PRESETS.find(t => t.id === id) || THEME_PRESETS[0];
}

// ==========================================
// 3. 多國語言字典 (i18n)
// ==========================================

const UI_TEXT = {
  'zh-TW': {
    dashboard: '主頁面',
    modules: '模組庫',
    settings: '設定',
    launch: '啟動生存',
    running: '運行中',
    disabled: '已停用',
    installed: '已安裝',
    type: '類型',
    version: '版本',
    authorIntro: '模組簡介',
    pakTitle: '引擎資源模組 (PAK)',
    ue4ssTitle: '腳本模組 (UE4SS)',
    engine: 'UE4SS 腳本引擎',
    notInstalled: '尚未安裝',
    updateAvailable: '需要更新',
    deploy: '部署引擎',
    update: '執行升級',
    status_uninstalled: '您尚未安裝 UE4SS 底層框架，腳本模組將無法載入。',
    status_update: '偵測到新版本，建議更新以確保相容性。',
    status_ok: '底層腳本注入框架已正確掛載，支援最新版模組。',
    processing: '系統正在背景為您下載並部署...',
    appearance: '介面外觀',
    appearanceDesc: '切換日夜模式，適應不同的生存環境',
    lightMode: '日間模式',
    darkMode: '深夜模式',
    dropzoneTitle: '安裝新模組',
    dropzoneDesc: '拖曳 .zip / .rar 或 .pak 至此處',
    dropzoneActive: '放開以開始解析...',
    importMod: '匯入檔案',
    uninstall: '解除安裝',
    toastInstalled: '模組已成功安裝',
    toastUninstalled: '模組已解除安裝',
    toastEnabled: '模組已啟用',
    toastDisabled: '模組已停用',
    toastProfileApplied: '配置檔已套用',
    toastProfileCreated: '配置檔已建立',
    toastProfileDeleted: '配置檔已刪除',
    toastEngineDone: '引擎部署完成',
    confirmTitle: '確認操作',
    confirmUninstallTitle: '確認解除安裝',
    confirmUninstallDesc: '確定要移除此模組嗎？此操作無法復原。',
    confirmDeleteProfileTitle: '確認刪除配置檔',
    confirmDeleteProfileDesc: '確定要刪除此配置檔嗎？',
    confirmYes: '確認',
    confirmCancel: '取消',
    profiles: '配置檔',
    newProfile: '建立配置檔',
    applyProfile: '套用',
    activeProfile: '使用中',
    noProfiles: '尚未建立任何配置檔',
    createFirstProfile: '建立你的第一個模組配置',
    profilePlaceholder: '輸入配置名稱...',
    profileModCount: '個模組已啟用',
    currentConfig: '目前配置',
    saveAsProfile: '儲存為配置檔',
    gamePath: '遊戲路徑',
    gamePathDesc: '自動偵測或手動選擇 HumanitZ 安裝位置',
    gamePathDetect: '自動偵測',
    gamePathBrowse: '瀏覽',
    gamePathNotFound: '未偵測到遊戲路徑',
    gamePathPlaceholder: '尚未設定路徑...',
    noMods: '尚未安裝任何模組',
    noModsDesc: '拖曳模組檔案到主頁面安裝',
    configEditor: '模組設定',
    configNoFiles: '此模組沒有可編輯的設定檔',
    configSave: '儲存',
    configSaved: '已儲存',
    configSaving: '儲存中...',
    configReset: '還原',
    configEditBtn: '設定',
    toastConfigSaved: '設定檔已儲存',
    toastConfigError: '設定檔儲存失敗',
    // Game running
    gameRunning: '遊戲運行中',
    // App update
    about: '關於',
    currentVersion: '目前版本',
    checkUpdate: '檢查更新',
    checking: '檢查中...',
    latestVersion: '已是最新版本',
    newVersion: '發現新版本',
    downloadUpdate: '下載更新',
    downloading: '下載中...',
    installUpdate: '安裝並重啟',
    updateReady: '更新已就緒',
    changelog: '更新日誌',
    // Conflicts
    conflictScan: '衝突偵測',
    conflictScanning: '掃描中...',
    conflictNone: '未發現模組衝突',
    conflictFound: '個資源衝突',
    conflictResource: '衝突資源',
    conflictMods: '衝突模組',
    // Logger
    viewLogs: '查看日誌',
    openLogFile: '開啟日誌檔案',
    logLoading: '載入中...',
    logEmpty: '暫無日誌',
    // Cache
    rescanMods: '重新掃描模組',
    rescanning: '掃描中...',
    theme: '主題色調',
    themeDesc: '選擇介面強調色與整體氛圍',
    themeEmber: '餘燼', themeCrimson: '赤紅', themeToxic: '毒霧', themeFrost: '寒霜', themeViolet: '幻紫', themeGold: '黃金',
  },
  en: {
    dashboard: 'Home',
    modules: 'Library',
    settings: 'Settings',
    launch: 'Launch Game',
    running: 'Running',
    disabled: 'Disabled',
    installed: 'Installed',
    type: 'Type',
    version: 'Version',
    authorIntro: 'Description',
    pakTitle: 'Resource Mods (PAK)',
    ue4ssTitle: 'Script Mods (UE4SS)',
    engine: 'UE4SS Engine',
    notInstalled: 'Not Installed',
    updateAvailable: 'Update Avail',
    deploy: 'Deploy Engine',
    update: 'Update Now',
    status_uninstalled: 'UE4SS framework is missing. Script mods will not load.',
    status_update: 'New version detected. Update recommended.',
    status_ok: 'Underlying script injection framework is successfully mounted.',
    processing: 'Downloading and deploying core components...',
    appearance: 'Appearance',
    appearanceDesc: 'Toggle Day/Night mode',
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    dropzoneTitle: 'Install Mod',
    dropzoneDesc: 'Drag & drop .zip, .rar, or .pak here',
    dropzoneActive: 'Release to parse...',
    importMod: 'Browse Files',
    uninstall: 'Uninstall',
    toastInstalled: 'Mod installed successfully',
    toastUninstalled: 'Mod uninstalled',
    toastEnabled: 'Mod enabled',
    toastDisabled: 'Mod disabled',
    toastProfileApplied: 'Profile applied',
    toastProfileCreated: 'Profile created',
    toastProfileDeleted: 'Profile deleted',
    toastEngineDone: 'Engine deployment complete',
    confirmTitle: 'Confirm Action',
    confirmUninstallTitle: 'Confirm Uninstall',
    confirmUninstallDesc: 'Are you sure you want to remove this mod? This cannot be undone.',
    confirmDeleteProfileTitle: 'Delete Profile',
    confirmDeleteProfileDesc: 'Are you sure you want to delete this profile?',
    confirmYes: 'Confirm',
    confirmCancel: 'Cancel',
    profiles: 'Profiles',
    newProfile: 'New Profile',
    applyProfile: 'Apply',
    activeProfile: 'Active',
    noProfiles: 'No profiles created yet',
    createFirstProfile: 'Create your first mod configuration',
    profilePlaceholder: 'Enter profile name...',
    profileModCount: 'mods enabled',
    currentConfig: 'Current Config',
    saveAsProfile: 'Save as Profile',
    gamePath: 'Game Path',
    gamePathDesc: 'Auto-detect or manually select HumanitZ install location',
    gamePathDetect: 'Auto Detect',
    gamePathBrowse: 'Browse',
    gamePathNotFound: 'Game path not found',
    gamePathPlaceholder: 'No path set...',
    noMods: 'No mods installed',
    noModsDesc: 'Drag mod files to Home to install',
    configEditor: 'Mod Settings',
    configNoFiles: 'No editable config files found',
    configSave: 'Save',
    configSaved: 'Saved',
    configSaving: 'Saving...',
    configReset: 'Reset',
    configEditBtn: 'Config',
    toastConfigSaved: 'Config saved',
    toastConfigError: 'Failed to save config',
    gameRunning: 'Game Running',
    about: 'About',
    currentVersion: 'Current Version',
    checkUpdate: 'Check for Updates',
    checking: 'Checking...',
    latestVersion: 'Up to date',
    newVersion: 'New version available',
    downloadUpdate: 'Download Update',
    downloading: 'Downloading...',
    installUpdate: 'Install & Restart',
    updateReady: 'Update Ready',
    changelog: 'Changelog',
    conflictScan: 'Conflict Scan',
    conflictScanning: 'Scanning...',
    conflictNone: 'No mod conflicts found',
    conflictFound: 'resource conflicts',
    conflictResource: 'Resource',
    conflictMods: 'Conflicting Mods',
    viewLogs: 'View Logs',
    openLogFile: 'Open Log File',
    logLoading: 'Loading...',
    logEmpty: 'No logs yet',
    rescanMods: 'Rescan Mods',
    rescanning: 'Scanning...',
    theme: 'Theme',
    themeDesc: 'Choose accent color and atmosphere',
    themeEmber: 'Ember', themeCrimson: 'Crimson', themeToxic: 'Toxic', themeFrost: 'Frost', themeViolet: 'Violet', themeGold: 'Gold',
  },
  ja: {
    dashboard: 'ホーム',
    modules: 'ライブラリ',
    settings: '設定',
    launch: 'ゲーム開始',
    running: '実行中',
    disabled: '無効',
    installed: 'インストール済み',
    type: 'タイプ',
    version: 'バージョン',
    authorIntro: 'Mod説明',
    pakTitle: 'リソースMod (PAK)',
    ue4ssTitle: 'スクリプトMod (UE4SS)',
    engine: 'UE4SS エンジン',
    notInstalled: '未インストール',
    updateAvailable: '更新あり',
    deploy: 'エンジン導入',
    update: '更新する',
    status_uninstalled: 'UE4SSフレームワークが未導入です。スクリプトModは読み込めません。',
    status_update: '新バージョンが検出されました。更新を推奨します。',
    status_ok: 'スクリプト注入フレームワークは正常にマウントされています。',
    processing: 'バックグラウンドでダウンロードおよび導入中...',
    appearance: '外観',
    appearanceDesc: 'ライト/ダークモードを切り替え',
    lightMode: 'ライトモード',
    darkMode: 'ダークモード',
    dropzoneTitle: 'Modをインストール',
    dropzoneDesc: '.zip / .rar / .pak をここにドラッグ',
    dropzoneActive: 'ドロップして解析...',
    importMod: 'ファイル選択',
    uninstall: 'アンインストール',
    toastInstalled: 'Modのインストール完了',
    toastUninstalled: 'Modをアンインストールしました',
    toastEnabled: 'Modを有効にしました',
    toastDisabled: 'Modを無効にしました',
    toastProfileApplied: 'プロファイルを適用しました',
    toastProfileCreated: 'プロファイルを作成しました',
    toastProfileDeleted: 'プロファイルを削除しました',
    toastEngineDone: 'エンジンの導入完了',
    confirmTitle: '操作の確認',
    confirmUninstallTitle: 'アンインストールの確認',
    confirmUninstallDesc: 'このModを削除しますか？この操作は取り消せません。',
    confirmDeleteProfileTitle: 'プロファイルの削除',
    confirmDeleteProfileDesc: 'このプロファイルを削除しますか？',
    confirmYes: '確認',
    confirmCancel: 'キャンセル',
    profiles: 'プロファイル',
    newProfile: '新規作成',
    applyProfile: '適用',
    activeProfile: '使用中',
    noProfiles: 'プロファイルがありません',
    createFirstProfile: '最初のMod構成を作成しましょう',
    profilePlaceholder: 'プロファイル名を入力...',
    profileModCount: '個のModが有効',
    currentConfig: '現在の構成',
    saveAsProfile: 'プロファイルとして保存',
    gamePath: 'ゲームパス',
    gamePathDesc: 'HumanitZのインストール先を自動検出または手動選択',
    gamePathDetect: '自動検出',
    gamePathBrowse: '参照',
    gamePathNotFound: 'ゲームパスが見つかりません',
    gamePathPlaceholder: 'パス未設定...',
    noMods: 'Modがインストールされていません',
    noModsDesc: 'ホームにModファイルをドラッグしてインストール',
    configEditor: 'Mod設定',
    configNoFiles: '編集可能な設定ファイルがありません',
    configSave: '保存',
    configSaved: '保存済み',
    configSaving: '保存中...',
    configReset: 'リセット',
    configEditBtn: '設定',
    toastConfigSaved: '設定を保存しました',
    toastConfigError: '設定の保存に失敗しました',
    gameRunning: 'ゲーム実行中',
    about: 'バージョン情報',
    currentVersion: '現在のバージョン',
    checkUpdate: '更新を確認',
    checking: '確認中...',
    latestVersion: '最新バージョンです',
    newVersion: '新しいバージョンがあります',
    downloadUpdate: '更新をダウンロード',
    downloading: 'ダウンロード中...',
    installUpdate: 'インストールして再起動',
    updateReady: '更新の準備完了',
    changelog: '更新履歴',
    conflictScan: '競合チェック',
    conflictScanning: 'スキャン中...',
    conflictNone: 'Modの競合はありません',
    conflictFound: '件のリソース競合',
    conflictResource: '競合リソース',
    conflictMods: '競合Mod',
    viewLogs: 'ログを表示',
    openLogFile: 'ログファイルを開く',
    logLoading: '読み込み中...',
    logEmpty: 'ログがありません',
    rescanMods: 'Modを再スキャン',
    rescanning: 'スキャン中...',
    theme: 'テーマ',
    themeDesc: 'アクセントカラーと雰囲気を選択',
    themeEmber: '残り火', themeCrimson: '紅蓮', themeToxic: '毒霧', themeFrost: '霜氷', themeViolet: '幻紫', themeGold: '黄金',
  },
  ko: {
    dashboard: '홈',
    modules: '라이브러리',
    settings: '설정',
    launch: '게임 시작',
    running: '실행 중',
    disabled: '비활성화',
    installed: '설치됨',
    type: '유형',
    version: '버전',
    authorIntro: '모드 설명',
    pakTitle: '리소스 모드 (PAK)',
    ue4ssTitle: '스크립트 모드 (UE4SS)',
    engine: 'UE4SS 엔진',
    notInstalled: '미설치',
    updateAvailable: '업데이트 필요',
    deploy: '엔진 설치',
    update: '업데이트',
    status_uninstalled: 'UE4SS 프레임워크가 설치되지 않았습니다. 스크립트 모드를 불러올 수 없습니다.',
    status_update: '새 버전이 감지되었습니다. 업데이트를 권장합니다.',
    status_ok: '스크립트 주입 프레임워크가 정상적으로 마운트되었습니다.',
    processing: '백그라운드에서 다운로드 및 설치 중...',
    appearance: '외관',
    appearanceDesc: '라이트/다크 모드 전환',
    lightMode: '라이트 모드',
    darkMode: '다크 모드',
    dropzoneTitle: '모드 설치',
    dropzoneDesc: '.zip / .rar / .pak 파일을 여기에 드래그',
    dropzoneActive: '놓으면 분석 시작...',
    importMod: '파일 선택',
    uninstall: '제거',
    toastInstalled: '모드가 설치되었습니다',
    toastUninstalled: '모드가 제거되었습니다',
    toastEnabled: '모드가 활성화되었습니다',
    toastDisabled: '모드가 비활성화되었습니다',
    toastProfileApplied: '프로필이 적용되었습니다',
    toastProfileCreated: '프로필이 생성되었습니다',
    toastProfileDeleted: '프로필이 삭제되었습니다',
    toastEngineDone: '엔진 설치 완료',
    confirmTitle: '작업 확인',
    confirmUninstallTitle: '제거 확인',
    confirmUninstallDesc: '이 모드를 제거하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    confirmDeleteProfileTitle: '프로필 삭제',
    confirmDeleteProfileDesc: '이 프로필을 삭제하시겠습니까?',
    confirmYes: '확인',
    confirmCancel: '취소',
    profiles: '프로필',
    newProfile: '새 프로필',
    applyProfile: '적용',
    activeProfile: '사용 중',
    noProfiles: '프로필이 없습니다',
    createFirstProfile: '첫 번째 모드 구성을 만들어 보세요',
    profilePlaceholder: '프로필 이름 입력...',
    profileModCount: '개 모드 활성화',
    currentConfig: '현재 구성',
    saveAsProfile: '프로필로 저장',
    gamePath: '게임 경로',
    gamePathDesc: 'HumanitZ 설치 위치를 자동 감지하거나 수동으로 선택',
    gamePathDetect: '자동 감지',
    gamePathBrowse: '찾아보기',
    gamePathNotFound: '게임 경로를 찾을 수 없습니다',
    gamePathPlaceholder: '경로 미설정...',
    noMods: '설치된 모드가 없습니다',
    noModsDesc: '홈에 모드 파일을 드래그하여 설치',
    configEditor: '모드 설정',
    configNoFiles: '편집 가능한 설정 파일이 없습니다',
    configSave: '저장',
    configSaved: '저장됨',
    configSaving: '저장 중...',
    configReset: '초기화',
    configEditBtn: '설정',
    toastConfigSaved: '설정이 저장되었습니다',
    toastConfigError: '설정 저장에 실패했습니다',
    gameRunning: '게임 실행 중',
    about: '정보',
    currentVersion: '현재 버전',
    checkUpdate: '업데이트 확인',
    checking: '확인 중...',
    latestVersion: '최신 버전입니다',
    newVersion: '새 버전 사용 가능',
    downloadUpdate: '업데이트 다운로드',
    downloading: '다운로드 중...',
    installUpdate: '설치 후 재시작',
    updateReady: '업데이트 준비 완료',
    changelog: '변경 사항',
    conflictScan: '충돌 검사',
    conflictScanning: '검사 중...',
    conflictNone: '모드 충돌이 없습니다',
    conflictFound: '개 리소스 충돌',
    conflictResource: '충돌 리소스',
    conflictMods: '충돌 모드',
    viewLogs: '로그 보기',
    openLogFile: '로그 파일 열기',
    logLoading: '로딩 중...',
    logEmpty: '로그가 없습니다',
    rescanMods: '모드 재검색',
    rescanning: '검색 중...',
    theme: '테마',
    themeDesc: '강조 색상과 분위기를 선택하세요',
    themeEmber: '잔불', themeCrimson: '진홍', themeToxic: '독안개', themeFrost: '서리', themeViolet: '보라', themeGold: '황금',
  },
  ru: {
    dashboard: 'Главная',
    modules: 'Библиотека',
    settings: 'Настройки',
    launch: 'Запустить игру',
    running: 'Работает',
    disabled: 'Отключён',
    installed: 'Установлен',
    type: 'Тип',
    version: 'Версия',
    authorIntro: 'Описание',
    pakTitle: 'Ресурсные моды (PAK)',
    ue4ssTitle: 'Скриптовые моды (UE4SS)',
    engine: 'Движок UE4SS',
    notInstalled: 'Не установлен',
    updateAvailable: 'Обновление',
    deploy: 'Установить движок',
    update: 'Обновить',
    status_uninstalled: 'Фреймворк UE4SS не установлен. Скриптовые моды не будут загружены.',
    status_update: 'Обнаружена новая версия. Рекомендуется обновление.',
    status_ok: 'Фреймворк внедрения скриптов успешно смонтирован.',
    processing: 'Загрузка и установка в фоновом режиме...',
    appearance: 'Внешний вид',
    appearanceDesc: 'Переключение светлой/тёмной темы',
    lightMode: 'Светлая тема',
    darkMode: 'Тёмная тема',
    dropzoneTitle: 'Установить мод',
    dropzoneDesc: 'Перетащите .zip / .rar / .pak сюда',
    dropzoneActive: 'Отпустите для анализа...',
    importMod: 'Выбрать файлы',
    uninstall: 'Удалить',
    toastInstalled: 'Мод успешно установлен',
    toastUninstalled: 'Мод удалён',
    toastEnabled: 'Мод включён',
    toastDisabled: 'Мод отключён',
    toastProfileApplied: 'Профиль применён',
    toastProfileCreated: 'Профиль создан',
    toastProfileDeleted: 'Профиль удалён',
    toastEngineDone: 'Установка движка завершена',
    confirmTitle: 'Подтвердите действие',
    confirmUninstallTitle: 'Подтвердите удаление',
    confirmUninstallDesc: 'Вы уверены, что хотите удалить этот мод? Это действие нельзя отменить.',
    confirmDeleteProfileTitle: 'Удалить профиль',
    confirmDeleteProfileDesc: 'Вы уверены, что хотите удалить этот профиль?',
    confirmYes: 'Подтвердить',
    confirmCancel: 'Отмена',
    profiles: 'Профили',
    newProfile: 'Новый профиль',
    applyProfile: 'Применить',
    activeProfile: 'Активен',
    noProfiles: 'Профили не созданы',
    createFirstProfile: 'Создайте вашу первую конфигурацию модов',
    profilePlaceholder: 'Введите название профиля...',
    profileModCount: 'модов включено',
    currentConfig: 'Текущая конфигурация',
    saveAsProfile: 'Сохранить как профиль',
    gamePath: 'Путь к игре',
    gamePathDesc: 'Автоопределение или ручной выбор папки HumanitZ',
    gamePathDetect: 'Автоопределение',
    gamePathBrowse: 'Обзор',
    gamePathNotFound: 'Путь к игре не найден',
    gamePathPlaceholder: 'Путь не задан...',
    noMods: 'Моды не установлены',
    noModsDesc: 'Перетащите файлы модов на главную для установки',
    configEditor: 'Настройки мода',
    configNoFiles: 'Нет доступных файлов настроек',
    configSave: 'Сохранить',
    configSaved: 'Сохранено',
    configSaving: 'Сохранение...',
    configReset: 'Сбросить',
    configEditBtn: 'Настроить',
    toastConfigSaved: 'Настройки сохранены',
    toastConfigError: 'Ошибка сохранения настроек',
    gameRunning: 'Игра запущена',
    about: 'О программе',
    currentVersion: 'Текущая версия',
    checkUpdate: 'Проверить обновления',
    checking: 'Проверка...',
    latestVersion: 'Установлена последняя версия',
    newVersion: 'Доступна новая версия',
    downloadUpdate: 'Скачать обновление',
    downloading: 'Загрузка...',
    installUpdate: 'Установить и перезапустить',
    updateReady: 'Обновление готово',
    changelog: 'Список изменений',
    conflictScan: 'Проверка конфликтов',
    conflictScanning: 'Сканирование...',
    conflictNone: 'Конфликтов модов не обнаружено',
    conflictFound: 'конфликтов ресурсов',
    conflictResource: 'Ресурс',
    conflictMods: 'Конфликтующие моды',
    viewLogs: 'Просмотр логов',
    openLogFile: 'Открыть файл лога',
    logLoading: 'Загрузка...',
    logEmpty: 'Логов пока нет',
    rescanMods: 'Пересканировать моды',
    rescanning: 'Сканирование...',
    theme: 'Тема',
    themeDesc: 'Выберите акцентный цвет и атмосферу',
    themeEmber: 'Угли', themeCrimson: 'Багряный', themeToxic: 'Токсичный', themeFrost: 'Мороз', themeViolet: 'Фиолет', themeGold: 'Золото',
  },
  de: {
    dashboard: 'Startseite',
    modules: 'Bibliothek',
    settings: 'Einstellungen',
    launch: 'Spiel starten',
    running: 'Läuft',
    disabled: 'Deaktiviert',
    installed: 'Installiert',
    type: 'Typ',
    version: 'Version',
    authorIntro: 'Beschreibung',
    pakTitle: 'Ressourcen-Mods (PAK)',
    ue4ssTitle: 'Skript-Mods (UE4SS)',
    engine: 'UE4SS Engine',
    notInstalled: 'Nicht installiert',
    updateAvailable: 'Update verfügbar',
    deploy: 'Engine installieren',
    update: 'Aktualisieren',
    status_uninstalled: 'UE4SS-Framework fehlt. Skript-Mods können nicht geladen werden.',
    status_update: 'Neue Version erkannt. Aktualisierung empfohlen.',
    status_ok: 'Skript-Injektions-Framework ist erfolgreich eingebunden.',
    processing: 'Download und Installation im Hintergrund...',
    appearance: 'Darstellung',
    appearanceDesc: 'Hell-/Dunkelmodus umschalten',
    lightMode: 'Hellmodus',
    darkMode: 'Dunkelmodus',
    dropzoneTitle: 'Mod installieren',
    dropzoneDesc: '.zip / .rar / .pak hierher ziehen',
    dropzoneActive: 'Loslassen zum Analysieren...',
    importMod: 'Dateien auswählen',
    uninstall: 'Deinstallieren',
    toastInstalled: 'Mod erfolgreich installiert',
    toastUninstalled: 'Mod deinstalliert',
    toastEnabled: 'Mod aktiviert',
    toastDisabled: 'Mod deaktiviert',
    toastProfileApplied: 'Profil angewendet',
    toastProfileCreated: 'Profil erstellt',
    toastProfileDeleted: 'Profil gelöscht',
    toastEngineDone: 'Engine-Installation abgeschlossen',
    confirmTitle: 'Aktion bestätigen',
    confirmUninstallTitle: 'Deinstallation bestätigen',
    confirmUninstallDesc: 'Möchten Sie diesen Mod wirklich entfernen? Dies kann nicht rückgängig gemacht werden.',
    confirmDeleteProfileTitle: 'Profil löschen',
    confirmDeleteProfileDesc: 'Möchten Sie dieses Profil wirklich löschen?',
    confirmYes: 'Bestätigen',
    confirmCancel: 'Abbrechen',
    profiles: 'Profile',
    newProfile: 'Neues Profil',
    applyProfile: 'Anwenden',
    activeProfile: 'Aktiv',
    noProfiles: 'Keine Profile vorhanden',
    createFirstProfile: 'Erstellen Sie Ihre erste Mod-Konfiguration',
    profilePlaceholder: 'Profilname eingeben...',
    profileModCount: 'Mods aktiviert',
    currentConfig: 'Aktuelle Konfiguration',
    saveAsProfile: 'Als Profil speichern',
    gamePath: 'Spielpfad',
    gamePathDesc: 'HumanitZ-Installationsort automatisch erkennen oder manuell auswählen',
    gamePathDetect: 'Automatisch erkennen',
    gamePathBrowse: 'Durchsuchen',
    gamePathNotFound: 'Spielpfad nicht gefunden',
    gamePathPlaceholder: 'Kein Pfad festgelegt...',
    noMods: 'Keine Mods installiert',
    noModsDesc: 'Mod-Dateien auf die Startseite ziehen',
    configEditor: 'Mod-Einstellungen',
    configNoFiles: 'Keine bearbeitbaren Konfigurationsdateien',
    configSave: 'Speichern',
    configSaved: 'Gespeichert',
    configSaving: 'Speichern...',
    configReset: 'Zurücksetzen',
    configEditBtn: 'Konfigurieren',
    toastConfigSaved: 'Einstellungen gespeichert',
    toastConfigError: 'Fehler beim Speichern',
    gameRunning: 'Spiel läuft',
    about: 'Über',
    currentVersion: 'Aktuelle Version',
    checkUpdate: 'Nach Updates suchen',
    checking: 'Prüfe...',
    latestVersion: 'Aktuell',
    newVersion: 'Neue Version verfügbar',
    downloadUpdate: 'Update herunterladen',
    downloading: 'Herunterladen...',
    installUpdate: 'Installieren & Neustarten',
    updateReady: 'Update bereit',
    changelog: 'Änderungsprotokoll',
    conflictScan: 'Konfliktprüfung',
    conflictScanning: 'Scannen...',
    conflictNone: 'Keine Mod-Konflikte gefunden',
    conflictFound: 'Ressourcenkonflikte',
    conflictResource: 'Ressource',
    conflictMods: 'Konflikt-Mods',
    viewLogs: 'Logs anzeigen',
    openLogFile: 'Log-Datei öffnen',
    logLoading: 'Laden...',
    logEmpty: 'Keine Logs vorhanden',
    rescanMods: 'Mods neu scannen',
    rescanning: 'Scannen...',
    theme: 'Farbschema',
    themeDesc: 'Akzentfarbe und Atmosphäre wählen',
    themeEmber: 'Glut', themeCrimson: 'Karmesin', themeToxic: 'Toxisch', themeFrost: 'Frost', themeViolet: 'Violett', themeGold: 'Gold',
  },
  fr: {
    dashboard: 'Accueil',
    modules: 'Bibliothèque',
    settings: 'Paramètres',
    launch: 'Lancer le jeu',
    running: 'En cours',
    disabled: 'Désactivé',
    installed: 'Installé',
    type: 'Type',
    version: 'Version',
    authorIntro: 'Description',
    pakTitle: 'Mods de ressources (PAK)',
    ue4ssTitle: 'Mods de scripts (UE4SS)',
    engine: 'Moteur UE4SS',
    notInstalled: 'Non installé',
    updateAvailable: 'Mise à jour dispo',
    deploy: 'Installer le moteur',
    update: 'Mettre à jour',
    status_uninstalled: "Le framework UE4SS est manquant. Les mods de scripts ne seront pas chargés.",
    status_update: 'Nouvelle version détectée. Mise à jour recommandée.',
    status_ok: "Le framework d'injection de scripts est correctement monté.",
    processing: 'Téléchargement et installation en arrière-plan...',
    appearance: 'Apparence',
    appearanceDesc: 'Basculer entre le mode clair et sombre',
    lightMode: 'Mode clair',
    darkMode: 'Mode sombre',
    dropzoneTitle: 'Installer un mod',
    dropzoneDesc: 'Glissez un .zip / .rar / .pak ici',
    dropzoneActive: 'Relâchez pour analyser...',
    importMod: 'Parcourir',
    uninstall: 'Désinstaller',
    toastInstalled: 'Mod installé avec succès',
    toastUninstalled: 'Mod désinstallé',
    toastEnabled: 'Mod activé',
    toastDisabled: 'Mod désactivé',
    toastProfileApplied: 'Profil appliqué',
    toastProfileCreated: 'Profil créé',
    toastProfileDeleted: 'Profil supprimé',
    toastEngineDone: "Installation du moteur terminée",
    confirmTitle: "Confirmer l'action",
    confirmUninstallTitle: 'Confirmer la désinstallation',
    confirmUninstallDesc: 'Voulez-vous vraiment supprimer ce mod ? Cette action est irréversible.',
    confirmDeleteProfileTitle: 'Supprimer le profil',
    confirmDeleteProfileDesc: 'Voulez-vous vraiment supprimer ce profil ?',
    confirmYes: 'Confirmer',
    confirmCancel: 'Annuler',
    profiles: 'Profils',
    newProfile: 'Nouveau profil',
    applyProfile: 'Appliquer',
    activeProfile: 'Actif',
    noProfiles: 'Aucun profil créé',
    createFirstProfile: 'Créez votre première configuration de mods',
    profilePlaceholder: 'Entrez le nom du profil...',
    profileModCount: 'mods activés',
    currentConfig: 'Configuration actuelle',
    saveAsProfile: 'Enregistrer comme profil',
    gamePath: 'Chemin du jeu',
    gamePathDesc: "Détection auto ou sélection manuelle de l'emplacement de HumanitZ",
    gamePathDetect: 'Détection auto',
    gamePathBrowse: 'Parcourir',
    gamePathNotFound: 'Chemin du jeu introuvable',
    gamePathPlaceholder: 'Aucun chemin défini...',
    noMods: 'Aucun mod installé',
    noModsDesc: "Glissez des fichiers de mods sur l'accueil pour installer",
    configEditor: 'Paramètres du mod',
    configNoFiles: 'Aucun fichier de configuration modifiable',
    configSave: 'Enregistrer',
    configSaved: 'Enregistré',
    configSaving: 'Enregistrement...',
    configReset: 'Réinitialiser',
    configEditBtn: 'Configurer',
    toastConfigSaved: 'Configuration enregistrée',
    toastConfigError: "Échec de l'enregistrement",
    gameRunning: 'Jeu en cours',
    about: 'À propos',
    currentVersion: 'Version actuelle',
    checkUpdate: 'Vérifier les mises à jour',
    checking: 'Vérification...',
    latestVersion: 'À jour',
    newVersion: 'Nouvelle version disponible',
    downloadUpdate: 'Télécharger la mise à jour',
    downloading: 'Téléchargement...',
    installUpdate: 'Installer et redémarrer',
    updateReady: 'Mise à jour prête',
    changelog: 'Notes de version',
    conflictScan: 'Détection de conflits',
    conflictScanning: 'Analyse...',
    conflictNone: 'Aucun conflit de mods détecté',
    conflictFound: 'conflits de ressources',
    conflictResource: 'Ressource',
    conflictMods: 'Mods en conflit',
    viewLogs: 'Voir les logs',
    openLogFile: 'Ouvrir le fichier log',
    logLoading: 'Chargement...',
    logEmpty: 'Aucun log disponible',
    rescanMods: 'Rescanner les mods',
    rescanning: 'Analyse...',
    theme: 'Thème',
    themeDesc: "Choisir la couleur d'accent et l'ambiance",
    themeEmber: 'Braise', themeCrimson: 'Cramoisi', themeToxic: 'Toxique', themeFrost: 'Givre', themeViolet: 'Violet', themeGold: 'Or',
  },
};

// ==========================================
// 3. 共用 UI 元件區 (Shared UI Components)
// ==========================================

const GlassCard = ({ children, className = '', isPill = true, onClick }) => {
  const cardRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current.style.setProperty('--glow-x', `${x}%`);
    cardRef.current.style.setProperty('--glow-y', `${y}%`);
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.setProperty('--glow-x', '50%');
    cardRef.current.style.setProperty('--glow-y', '50%');
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`
        glass-glow relative isolate transform-gpu overflow-hidden ${isPill ? 'rounded-full' : 'rounded-[1.5rem] md:rounded-[2.5rem]'}
        bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl
        border border-white/80 dark:border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.15)]
        transition-all duration-500 ease-out outline-none focus:outline-none active:outline-none ring-0 focus:ring-0 [-webkit-tap-highlight-color:transparent]
        hover:bg-white/80 dark:hover:bg-slate-800/80 hover:border-white/90 dark:hover:border-white/20 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]
        cursor-pointer
        ${className}
      `}
    >
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white/50 dark:from-white/5 to-transparent opacity-0 transition-opacity duration-700 hover:opacity-100 pointer-events-none" />
      {children}
    </div>
  );
};

// ==========================================
// 3a. 動畫數字 (Animated Number Counter)
// ==========================================

const AnimatedNumber = ({ value, className = '' }) => {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    if (start === end) return;
    const duration = 600;
    const startTime = performance.now();
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    prevValue.current = end;
  }, [value]);

  return <span className={`${className} ${display !== prevValue.current ? '' : 'count-pop'}`} style={{ display: 'inline-block' }}>{display}</span>;
};

// ==========================================
// 3b. Toast 通知系統 (Toast Notification System)
// ==========================================

const ToastContainer = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto flex items-center gap-3 px-5 py-3.5 min-w-[280px] max-w-[400px]
            rounded-2xl backdrop-blur-xl border
            animate-toast-in
            ${toast.type === 'success'
              ? 'bg-emerald-500/15 dark:bg-emerald-500/10 border-emerald-300/40 dark:border-emerald-500/20 shadow-[0_10px_15px_-3px_rgba(16,185,129,0.1)]'
              : toast.type === 'error'
              ? 'bg-rose-500/15 dark:bg-rose-500/10 border-rose-300/40 dark:border-rose-500/20 shadow-[0_10px_15px_-3px_rgba(244,63,94,0.1)]'
              : toast.type === 'warning'
              ? 'bg-amber-500/15 dark:bg-amber-500/10 border-amber-300/40 dark:border-amber-500/20 shadow-[0_10px_15px_-3px_rgba(245,158,11,0.1)]'
              : 'bg-white/60 dark:bg-slate-900/60 border-white/40 dark:border-white/10 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.2)]'
            }
            transition-all duration-500
          `}
        >
          <div className={`shrink-0 p-1.5 rounded-full ${
            toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            : toast.type === 'error' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
            : toast.type === 'warning' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
            : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300'
          }`}>
            {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {toast.type === 'error' && <X className="w-4 h-4" />}
            {toast.type === 'warning' && <AlertTriangle className="w-4 h-4" />}
            {toast.type === 'info' && <Info className="w-4 h-4" />}
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 leading-snug">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all duration-200 active:scale-90"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

// ==========================================
// 3c. 確認對話框 (Confirm Modal)
// ==========================================

const ConfirmModal = ({ isOpen, title, description, onConfirm, onCancel, t, confirmVariant = 'danger' }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] p-6 md:p-8 animate-modal-spring flex flex-col items-center text-center gap-4"
      >
        <div className={`p-4 rounded-full ${confirmVariant === 'danger' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-500' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-500'}`}>
          {confirmVariant === 'danger' ? <Trash2 className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
        </div>

        <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight">{title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{description}</p>

        <div className="flex items-center gap-3 w-full mt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-300 active:scale-95"
          >
            {t.confirmCancel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-full text-white transition-all duration-300 active:scale-95 ${
              confirmVariant === 'danger'
                ? 'bg-rose-500 hover:bg-rose-600 shadow-[0_10px_15px_-3px_rgba(244,63,94,0.3)]'
                : 'bg-amber-500 hover:bg-amber-600 shadow-[0_10px_15px_-3px_rgba(245,158,11,0.3)]'
            }`}
          >
            {t.confirmYes}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 3d. Config 編輯器彈窗 (Config Editor Modal)
// ==========================================

// 統一解析 config 檔案（支援 INI / Lua / 混合格式）
function parseConfigFile(text) {
  const lines = text.split('\n');
  const entries = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行
    if (trimmed === '') { entries.push({ type: 'blank', raw: line }); continue; }

    // Lua 多行註解 --[[ ... ]]
    if (trimmed.includes('--[[') && !inBlockComment) { inBlockComment = true; entries.push({ type: 'comment', raw: line, text: '' }); continue; }
    if (inBlockComment) { if (trimmed.includes(']]')) inBlockComment = false; entries.push({ type: 'comment', raw: line, text: '' }); continue; }

    // 各種單行註解（-- ; # //）
    if (trimmed.startsWith('--') || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      let commentBody = trimmed.replace(/^(--|;|#|\/\/)\s*/, '');
      // 分隔線、裝飾線、純符號行 → 不顯示文字
      const isDecorative = /^[=\-~*#\[\](){}<>\/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
      entries.push({ type: 'comment', raw: line, text: isDecorative ? '' : commentBody });
      continue;
    }

    // Lua 結構語法（local X = {, }, return X）
    if (trimmed.match(/^local\s+\w+\s*=\s*\{/) || trimmed === '{' || trimmed === '}' || trimmed.match(/^return\s+\w/)) {
      entries.push({ type: 'lua_structure', raw: line }); continue;
    }

    // INI section [SectionName]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      entries.push({ type: 'section', raw: line, name: trimmed.slice(1, -1) }); continue;
    }

    // key = value（通用，支援 INI 和 Lua）
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+?),?\s*$/);
    if (kvMatch) {
      let value = kvMatch[2].trim();
      if (value.endsWith(',')) value = value.slice(0, -1).trim();
      // 去掉引號取裸值
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      const bareValue = isQuoted ? value.slice(1, -1) : value;
      // 判斷原始格式（有逗號結尾或在 Lua 結構內 → lua）
      const isLua = line.match(/,\s*$/) || text.includes('--[[');
      entries.push({ type: 'keyval', raw: line, key: kvMatch[1], value: bareValue, isQuoted, format: isLua ? 'lua' : 'ini' });
      continue;
    }

    // 其他 → 當註解處理
    entries.push({ type: 'comment', raw: line, text: '' });
  }
  return entries;
}

// 將結構化資料轉回文字
function serializeConfig(entries) {
  return entries.map((e) => {
    if (e.type === 'keyval') {
      const indent = e.raw.match(/^(\s*)/)?.[1] || '';
      const val = e.isQuoted ? `"${e.value}"` : e.value;
      const comma = e.format === 'lua' && e.raw.match(/,\s*$/) ? ',' : '';
      return `${indent}${e.key} = ${val}${comma}`;
    }
    return e.raw;
  }).join('\n');
}

// 判斷值類型
function guessValueType(val) {
  if (val === 'true' || val === 'false') return 'bool';
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return 'float';
  return 'string';
}

const ConfigEditorModal = ({ isOpen, mod, onClose, t, lang, addToast }) => {
  const [configFiles, setConfigFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [originalEntries, setOriginalEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !mod || !window.api) return;
    setLoading(true);
    setConfigFiles([]);
    setSelectedFile(null);
    setEntries([]);
    setOriginalEntries([]);

    (async () => {
      try {
        const files = await window.api.mods.getConfigFiles(mod.filename);
        // 過濾掉 main.lua 和 Scripts 內的檔案
        const filtered = (files || []).filter(f =>
          f.name.toLowerCase() !== 'main.lua' &&
          !f.relativePath.toLowerCase().startsWith('scripts/')
        );

        // 合併所有有 key=value 的設定項
        const allEntries = [];
        const validFiles = [];
        for (const file of filtered) {
          try {
            const text = await window.api.mods.readConfig(mod.filename, file.relativePath);
            const parsed = parseConfigFile(text);
            const hasKeyval = parsed.some(e => e.type === 'keyval');
            if (hasKeyval) {
              validFiles.push(file);
              // 加上檔案來源標記
              parsed.forEach(e => { e._file = file; });
              allEntries.push(...parsed);
            }
          } catch { /* skip */ }
        }

        setConfigFiles(validFiles);
        setSelectedFile(validFiles.length > 0 ? validFiles[0] : null);
        setEntries(allEntries);
        setOriginalEntries(JSON.parse(JSON.stringify(allEntries)));
      } catch {
        setConfigFiles([]);
      }
      setLoading(false);
    })();
  }, [isOpen, mod]);

  const updateValue = (idx, newValue) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, value: newValue } : e));
  };

  const handleSave = async () => {
    if (!mod || configFiles.length === 0) return;
    setSaving(true);
    try {
      // 按檔案分組儲存
      for (const file of configFiles) {
        const fileEntries = entries.filter(e => e._file?.relativePath === file.relativePath);
        const text = serializeConfig(fileEntries);
        await window.api.mods.saveConfig(mod.filename, file.relativePath, text);
      }
      setOriginalEntries(JSON.parse(JSON.stringify(entries)));
      addToast(t.toastConfigSaved, 'success');
    } catch {
      addToast(t.toastConfigError, 'error');
    }
    setSaving(false);
  };

  const handleReset = () => {
    setEntries(JSON.parse(JSON.stringify(originalEntries)));
  };

  const hasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);
  const keyvalEntries = entries.filter(e => e.type === 'keyval');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[85vh] bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="p-2.5 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
            <Sliders className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-black text-slate-800 dark:text-white tracking-tight truncate">{t.configEditor}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">{cleanModName(mod?.title || mod?.filename || '')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-90">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — 設定欄位列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
          ) : configFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : keyvalEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {entries.map((entry, idx) => {
                if (entry.type === 'section') {
                  return (
                    <div key={idx} className="mt-3 mb-1 first:mt-0">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-500)' }}>{entry.name}</h4>
                      <div className="h-px mt-1" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.2)' }} />
                    </div>
                  );
                }
                if (entry.type !== 'keyval') return null;

                const valType = guessValueType(entry.value);
                const globalIdx = idx;

                // 取得上方緊鄰的註解作為描述
                let description = null;
                for (let i = idx - 1; i >= 0; i--) {
                  if (entries[i].type === 'comment' && entries[i].text) { description = entries[i].text; break; }
                  if (entries[i].type === 'blank') continue;
                  break;
                }
                // 清理註解格式，根據語言選擇
                if (description) {
                  const slashParts = description.split('/').map(s => s.trim()).filter(Boolean);
                  if (slashParts.length > 1) {
                    const zhPart = slashParts.find(s => /[\u4e00-\u9fff]/.test(s));
                    const enPart = slashParts.find(s => !/[\u4e00-\u9fff]/.test(s));
                    if (lang === 'zh-TW' && zhPart) description = zhPart;
                    else if (lang !== 'zh-TW' && enPart) description = enPart;
                    else if (zhPart) description = zhPart;
                  }
                  // 移除 「範例 :」「Example :」「"Fixed" :」 開頭
                  description = description.replace(/^["'].+?["']\s*[:：]\s*/g, '');
                  description = description.replace(/^(範例|example|e\.g\.?|ex)\s*[:：]\s*/i, '');
                  description = description.replace(/^["']|["']$/g, '').trim();
                  if (description.length > 40) description = description.slice(0, 40) + '…';
                }
                // 如果沒有註解，根據 key 名稱生成可讀文字
                if (!description) {
                  description = entry.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
                }

                return (
                  <div key={idx} className="flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{entry.key}</label>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full leading-none ${
                          valType === 'bool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                          : valType === 'int' || valType === 'float' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}>{valType === 'bool' ? 'ON/OFF' : valType === 'int' ? 'INT' : valType === 'float' ? 'FLOAT' : 'TEXT'}</span>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>
                    </div>
                    <div className="shrink-0 w-44">
                      {valType === 'bool' ? (
                        <button
                          onClick={() => updateValue(globalIdx, entry.value === 'true' ? 'false' : 'true')}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${entry.value !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                          style={entry.value === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${entry.value === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      ) : (
                        <input
                          type="text"
                          inputMode={valType === 'int' ? 'numeric' : valType === 'float' ? 'decimal' : 'text'}
                          value={entry.value}
                          onChange={(e) => updateValue(globalIdx, e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
                          style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                          onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
                          onBlur={(e) => { e.target.style.borderColor = ''; }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {keyvalEntries.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200/60 dark:border-slate-700/50">
            <button
              onClick={handleReset}
              disabled={!hasChanges}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.configReset}
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? t.configSaving : hasChanges ? t.configSave : t.configSaved}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3e. 行內展開的詳細視圖 (Module Detail Inline)
// ==========================================

const ModuleDetailInline = ({ activeMod, isActive, t, onOpenConfig }) => {
  const iconInfo = getModIcon(activeMod);
  const IconComponent = iconInfo.icon;

  const title = cleanModName(activeMod.title || activeMod.filename);
  const description = activeMod.description || cleanModName(activeMod.filename) || '';

  return (
    <div className={`grid transition-all duration-500 ease-out ${isActive ? 'grid-rows-[1fr] opacity-100 mt-1 mb-2' : 'grid-rows-[0fr] opacity-0 mt-0 mb-0'}`}>
      <div className="overflow-hidden p-2 -m-2">
        <div className="relative w-full rounded-[1.5rem] md:rounded-[2rem] bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-white/60 dark:border-slate-700/50 shadow-md flex flex-col transition-colors duration-700 p-4 md:p-5">

          {activeMod.type === 'UE4SS' && onOpenConfig && (
            <div className="absolute top-3 right-3 md:top-4 md:right-4 z-20">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenConfig(activeMod); }}
                className="h-7 px-2.5 rounded-full flex items-center justify-center gap-1 transition-colors shadow-sm active:scale-95"
                style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--accent-500)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(var(--accent-rgb), 0.2)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.08)'; e.currentTarget.style.color = 'var(--accent-500)'; }}
                title={t.configEditBtn}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden sm:inline">{t.configEditBtn}</span>
              </button>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-4 md:gap-5 z-10">
            <div className="flex flex-col items-center md:items-start shrink-0">
              <div className={`w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 flex items-center justify-center shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.3)] mb-3 transition-colors duration-700`}>
                <IconComponent className={`w-7 h-7 md:w-8 md:h-8 ${iconInfo.iconColor}`} />
              </div>
              <div className="flex flex-col gap-1 w-full px-1">
                {activeMod.type && (
                <div className="flex justify-between text-[10px] md:text-[11px] border-b border-slate-200/50 dark:border-slate-800 pb-1 transition-colors duration-700">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">{t.type}</span>
                  <span className={`flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full transition-colors duration-700 ${activeMod.type === 'PAK' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-400'}`}>
                    {activeMod.type === 'PAK' ? <Package className="w-2.5 h-2.5" /> : <Terminal className="w-2.5 h-2.5" />}
                    {activeMod.type}
                  </span>
                </div>
                )}
                {activeMod.version && (
                  <div className="flex justify-between text-[10px] md:text-[11px] border-b border-slate-200/50 dark:border-slate-800 pb-1 transition-colors duration-700">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">{t.version}</span>
                    <span className="text-slate-700 dark:text-slate-200 font-mono font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full transition-colors duration-700">{activeMod.version}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col flex-1 min-w-0">
              <h2 className="text-lg md:text-xl font-black text-slate-800 dark:text-white mb-1.5 pr-8 tracking-tight transition-colors duration-700">
                {title}
              </h2>


              <div>
                <h4 className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-1 uppercase tracking-widest transition-colors duration-700">{t.authorIntro}</h4>
                <div className="p-2.5 md:p-3 rounded-xl bg-white/40 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 shadow-sm transition-colors duration-700">
                  <p className="text-[11px] md:text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium transition-colors duration-700">
                    {description}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 4. 列表渲染元件 (List Rendering Components)
// ==========================================

const ModuleList = ({ modules, type, title, icon: Icon, colorClass, activeModuleId, onModuleClick, onToggle, onUninstallLocal, onOpenConfig, t, lang, newlyInstalledMods }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const filteredModules = modules.filter(m => m.type === type);
  if (filteredModules.length === 0) return null;

  return (
    <div className="animate-slide-up">
      <div
        className={`flex items-center gap-2 px-4 cursor-pointer group transition-all duration-300 outline-none focus:outline-none active:outline-none [-webkit-tap-highlight-color:transparent] rounded-full py-1 ${isExpanded ? 'mb-3' : 'mb-1'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Icon className={`w-5 h-5 ${colorClass} dark:opacity-90 transition-transform duration-500 ${!isExpanded && 'scale-90 opacity-70 rotate-12'}`} />
        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 tracking-wide transition-colors duration-300 group-hover:text-slate-900 dark:group-hover:text-white">{title}</h3>
        <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold transition-colors duration-700 shadow-inner">{filteredModules.length}</span>

        <div className="ml-auto p-1 rounded-full bg-transparent group-hover:bg-slate-200/50 dark:group-hover:bg-slate-800/50 transition-all duration-300 group-hover:shadow-sm">
          <ChevronDown className={`w-5 h-5 text-slate-400 dark:text-slate-500 transition-transform duration-500 ease-out ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
        </div>
      </div>

      <div className={`grid transition-all duration-500 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden flex flex-col gap-2.5 px-2 pt-1">
          {filteredModules.map((mod, index) => {
            const iconInfo = getModIcon(mod);
            const modKey = mod.id || mod.filename;
            return (
              <div
                key={modKey}
                className="flex flex-col relative animate-slide-up"
                style={{ animationFillMode: 'both', animationDelay: `${index * 60}ms`, animationDuration: '600ms' }}
              >
                <GlassCard onClick={() => onModuleClick(modKey)} className={`group flex flex-row items-center px-3 py-2 md:px-4 md:py-2.5 gap-3 md:gap-4 relative z-10 ${activeModuleId === modKey ? 'bg-white/80 dark:bg-slate-800/80' : ''} ${newlyInstalledMods?.has(modKey) ? 'ring-2' : ''}`} style={{ ...(activeModuleId === modKey ? { boxShadow: `0 0 0 2px rgba(var(--accent-rgb), 0.5)` } : {}), ...(newlyInstalledMods?.has(modKey) ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.6)', animation: 'newModPulse 0.8s ease-out 2' } : {}) }}>
                  <div className={`w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 shrink-0 transition-all duration-300 shadow-sm group-hover:scale-105 group-hover:shadow-md ${!mod.enabled ? 'opacity-50 grayscale' : ''}`}>
                    <iconInfo.icon className={`w-4 h-4 md:w-5 md:h-5 ${iconInfo.iconColor}`} />
                  </div>

                  <div className={`flex flex-col flex-1 min-w-0 transition-opacity duration-300 ${!mod.enabled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700" onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-600)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = ''; }}>{cleanModName(mod.title || mod.filename)}</h4>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 leading-none transition-colors duration-700">{mod.version || mod.type}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{mod.description || mod.filename}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); onUninstallLocal(mod.filename); }}
                        className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                        title={t.uninstall}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <span className={`hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors duration-300 ${mod.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                        {mod.enabled ? <CheckCircle className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                        {mod.enabled ? t.running : t.disabled}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const knob = e.currentTarget.querySelector('.toggle-knob');
                          if (knob) { knob.classList.remove('toggle-bounce'); void knob.offsetWidth; knob.classList.add('toggle-bounce'); }
                          onToggle(mod.filename);
                        }}
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${!mod.enabled ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                        style={mod.enabled ? { backgroundColor: 'var(--accent-500)' } : undefined}
                      >
                        <span className={`toggle-knob inline-block h-3 w-3 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${mod.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <div className={`p-1.5 rounded-full transition-all duration-300 ${activeModuleId !== modKey ? 'bg-transparent group-hover:bg-slate-100 dark:group-hover:bg-slate-800 text-slate-400 dark:text-slate-500' : ''}`} style={activeModuleId === modKey ? { backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' } : undefined}>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-500 ease-out ${activeModuleId === modKey ? 'rotate-180' : 'rotate-0 group-hover:translate-y-px'}`} />
                    </div>
                  </div>
                </GlassCard>

                <ModuleDetailInline
                  activeMod={mod}
                  isActive={activeModuleId === modKey}
                  t={t}
                  onOpenConfig={onOpenConfig}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 4. 主應用程式 (Main App Component)
// ==========================================

export default function App() {
  const [lang, setLang] = useState('zh-TW');
  const [supportedLocales, setSupportedLocales] = useState([]);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef(null);
  const [isDark, setIsDark] = useState(false);
  const [themeId, setThemeId] = useState('ember');
  const t = UI_TEXT[lang];

  const [modules, setModules] = useState([]);
  const [newlyInstalledMods, setNewlyInstalledMods] = useState(new Set());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeModuleId, setActiveModuleId] = useState(null);

  // UE4SS state
  const [ue4ssStatus, setUe4ssStatus] = useState('uninstalled');
  const [ue4ssProgress, setUe4ssProgress] = useState(0);
  const [ue4ssVersion, setUe4ssVersion] = useState(null);

  // Settings state
  const [gamePath, setGamePath] = useState(null);
  const [gameVersion, setGameVersion] = useState(null);

  // Drag & drop
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Sidebar sliding indicator
  const navRef = useRef(null);
  const [indicatorTop, setIndicatorTop] = useState(0);

  useEffect(() => {
    if (!navRef.current) return;
    const btn = navRef.current.querySelector(`[data-tab="${activeTab}"]`);
    if (!btn) return;
    const navRect = navRef.current.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setIndicatorTop(btnRect.top - navRect.top + (btnRect.height - 24) / 2);
  }, [activeTab]);

  // 共用：重新掃描模組
  const prevModFilenames = useRef(new Set());
  const refreshMods = useCallback(async (trackNew = false) => {
    if (!window.api) return;
    const mods = await window.api.mods.scan();
    if (trackNew && prevModFilenames.current.size > 0) {
      const newMods = new Set();
      mods.forEach(m => {
        const key = m.id || m.filename;
        if (!prevModFilenames.current.has(key)) newMods.add(key);
      });
      if (newMods.size > 0) {
        setNewlyInstalledMods(newMods);
        setTimeout(() => setNewlyInstalledMods(new Set()), 2000);
      }
    }
    prevModFilenames.current = new Set(mods.map(m => m.id || m.filename));
    setModules(mods);
  }, []);

  // Toast system
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Config editor modal
  const [configEditorMod, setConfigEditorMod] = useState(null);

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger' });

  const showConfirm = useCallback((title, description, onConfirm, variant = 'danger') => {
    setConfirmModal({ isOpen: true, title, description, onConfirm, variant });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmModal({ isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger' });
  }, []);

  // Profile system (persisted via settings)
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');

  // ==========================================
  // 6. 初始化 (Init)
  // ==========================================

  useEffect(() => {
    async function init() {
      if (!window.api) return;

      // Load language preference via locale API
      const savedLang = await window.api.locale.getPreference();
      const locales = await window.api.locale.getSupported();
      setLang(savedLang);
      setSupportedLocales(locales);

      // Load dark mode setting
      const savedDark = await window.api.settings.get('darkMode', false);
      setIsDark(savedDark);

      // Load theme
      const savedTheme = await window.api.settings.get('themeId', 'ember');
      setThemeId(savedTheme);

      // Load profiles
      const savedProfiles = await window.api.settings.get('profiles', []);
      const savedActiveProfileId = await window.api.settings.get('activeProfileId', null);
      setProfiles(Array.isArray(savedProfiles) ? savedProfiles : []);
      setActiveProfileId(savedActiveProfileId);

      // Detect game path
      const path = await window.api.game.detectPath();
      setGamePath(path);

      // Scan mods if path exists
      if (path) {
        await refreshMods();
      }

      // Load game version
      try {
        const ver = await window.api.game.getVersion();
        setGameVersion(ver);
      } catch { /* ignore */ }

      // Load UE4SS status
      try {
        const status = await window.api.ue4ss.getStatus();
        setUe4ssStatus(status.status);
        setUe4ssVersion(status.version || null);
      } catch { /* ignore */ }

      // Load app version
      try {
        const ver = await window.api.appUpdate.getVersion();
        setAppVersion(ver);
      } catch { /* ignore */ }
    }
    init();
  }, []);

  // Listen for mod updates
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.mods.onUpdated(async () => {
      await refreshMods(true);
    });
    return unsub;
  }, []);

  // Listen for UE4SS progress
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.ue4ss.onProgress((progress) => {
      setUe4ssProgress(progress);
    });
    return unsub;
  }, []);

  // Close language dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ==========================================
  // 7. 設定持久化 (Settings Persistence)
  // ==========================================

  const persistSetting = useCallback((key, value) => {
    if (window.api) window.api.settings.set(key, value);
  }, []);

  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev;
      persistSetting('darkMode', next);
      return next;
    });
  };

  const activeTransitionRef = useRef(null);

  const changeTheme = useCallback((id, e) => {
    if (id === themeId) return;
    // Skip any in-progress transition immediately
    if (activeTransitionRef.current) {
      activeTransitionRef.current.skipTransition();
      activeTransitionRef.current = null;
    }
    if (e && document.startViewTransition) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const maxDist = Math.max(
        Math.hypot(x, y),
        Math.hypot(window.innerWidth - x, y),
        Math.hypot(x, window.innerHeight - y),
        Math.hypot(window.innerWidth - x, window.innerHeight - y)
      );
      const duration = 1000;
      const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

      const transition = document.startViewTransition(() => {
        flushSync(() => {
          setThemeId(id);
        });
        persistSetting('themeId', id);
      });
      activeTransitionRef.current = transition;
      transition.finished.then(() => { activeTransitionRef.current = null; });
      transition.ready.then(() => {
        // New theme reveals via expanding circle
        document.documentElement.animate([
          { clipPath: `circle(0px at ${x}px ${y}px)` },
          { clipPath: `circle(${maxDist}px at ${x}px ${y}px)` },
        ], { duration, easing, pseudoElement: '::view-transition-new(root)' });
        // Old theme dims as circle approaches — makes the wave edge visible
        document.documentElement.animate([
          { filter: 'brightness(1)', opacity: 1 },
          { filter: 'brightness(0.96)', opacity: 0.98 },
        ], { duration, easing, pseudoElement: '::view-transition-old(root)' });
      });
    } else {
      setThemeId(id);
      persistSetting('themeId', id);
    }
  }, [themeId, persistSetting]);

  // Apply theme CSS variables
  useEffect(() => {
    const theme = getTheme(themeId);
    const root = document.documentElement;
    Object.entries(theme.accent).forEach(([key, val]) => {
      root.style.setProperty(`--accent-${key}`, val);
    });
    root.style.setProperty('--gradient-from', theme.gradient.from);
    root.style.setProperty('--gradient-to', theme.gradient.to);
    theme.orbs.light.forEach((c, i) => root.style.setProperty(`--orb-light-${i + 1}`, c));
    theme.orbs.dark.forEach((c, i) => root.style.setProperty(`--orb-dark-${i + 1}`, c));
  }, [themeId]);

  const changeLang = useCallback((code) => {
    setLang(code);
    setLangDropdownOpen(false);
    if (window.api) window.api.locale.setPreference(code);
  }, []);

  // ==========================================
  // 8. 事件處理 (Event Handlers)
  // ==========================================

  const handleModuleClick = (modId) => {
    setActiveModuleId(prev => prev === modId ? null : modId);
  };

  const handleToggleEnable = async (filename) => {
    if (!window.api) return;
    try {
      const result = await window.api.mods.toggle(filename);
      await refreshMods();
      addToast(result.enabled ? t.toastEnabled : t.toastDisabled, result.enabled ? 'success' : 'info');
    } catch (err) { console.error('Toggle failed:', err); }
  };

  const handleUninstallLocalMod = (filename) => {
    showConfirm(t.confirmUninstallTitle, t.confirmUninstallDesc, async () => {
      if (!window.api) return;
      try {
        await window.api.mods.remove(filename);
        await refreshMods();
        if (activeModuleId === filename) setActiveModuleId(null);
        addToast(t.toastUninstalled, 'warning');
      } catch (err) { console.error('Uninstall failed:', err); }
      closeConfirm();
    });
  };

  const handleUe4ssAction = async () => {
    if (!window.api) return;
    const action = ue4ssStatus === 'uninstalled' ? 'install' : 'update';
    setUe4ssStatus(action === 'install' ? 'installing' : 'updating');
    setUe4ssProgress(0);
    try {
      const result = await window.api.ue4ss[action]();
      setUe4ssStatus('installed');
      if (result?.version) setUe4ssVersion(result.version);
      addToast(t.toastEngineDone, 'success');
    } catch (err) {
      console.error('UE4SS action failed:', err);
      setUe4ssStatus('uninstalled');
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!window.api) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length > 0) {
      try {
        await window.api.mods.install(paths);
        addToast(t.toastInstalled, 'success');
      } catch (err) { console.error('Install failed:', err); }
    }
  };

  const handleImportFiles = async () => {
    if (!window.api) return;
    const files = await window.api.system.selectFiles();
    if (files && files.length > 0) {
      try {
        await window.api.mods.install(files);
        addToast(t.toastInstalled, 'success');
      } catch (err) { console.error('Install failed:', err); }
    }
  };

  const [detecting, setDetecting] = useState(false);

  // App update state
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle'); // idle | checking | available | latest | downloading | ready
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);

  // Conflict & log modals
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState(null); // null=not loaded, []=no conflicts
  const [conflictScanning, setConflictScanning] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logLines, setLogLines] = useState(null);
  const [logLoading, setLogLoading] = useState(false);

  // Cache rescan
  const [rescanning, setRescanning] = useState(false);

  const handleDetectPath = async () => {
    if (!window.api || detecting) return;
    setDetecting(true);
    try {
      const [path] = await Promise.all([
        window.api.game.detectPath(),
        new Promise(r => setTimeout(r, 800)),
      ]);
      setGamePath(path);
      if (path) {
        await refreshMods();
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleBrowsePath = async () => {
    if (!window.api) return;
    const folder = await window.api.system.selectFolder();
    if (folder) {
      await window.api.game.setPath(folder);
      setGamePath(folder);
      await refreshMods();
    }
  };

  const [isGameRunning, setIsGameRunning] = useState(false);

  useEffect(() => {
    if (!window.api) return;
    const check = async () => {
      try { setIsGameRunning(await window.api.game.isRunning()); } catch {}
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  // App update handlers
  const handleCheckUpdate = async () => {
    if (!window.api) return;
    setUpdateState('checking');
    try {
      const result = await window.api.appUpdate.check();
      if (result.hasUpdate) {
        setUpdateInfo(result);
        setUpdateState('available');
      } else {
        setUpdateState('latest');
      }
    } catch {
      setUpdateState('idle');
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.api) return;
    setUpdateState('downloading');
    setUpdateProgress(0);
    const unsub = window.api.appUpdate.onProgress((p) => setUpdateProgress(p));
    try {
      await window.api.appUpdate.download(updateInfo?.downloadUrl);
      setUpdateState('ready');
    } catch {
      setUpdateState('available');
    }
    unsub();
  };

  const handleInstallUpdate = async () => {
    if (!window.api) return;
    await window.api.appUpdate.install();
  };

  // Conflict scan
  const handleConflictScan = async () => {
    setConflictModalOpen(true);
    setConflictScanning(true);
    try {
      const result = await window.api.conflicts.scan();
      setConflicts(result || []);
    } catch {
      setConflicts([]);
    }
    setConflictScanning(false);
  };

  // Log viewer
  const handleOpenLogs = async () => {
    setLogModalOpen(true);
    setLogLoading(true);
    try {
      const lines = await window.api.logger.readRecent();
      setLogLines(lines || []);
    } catch {
      setLogLines([]);
    }
    setLogLoading(false);
  };

  const handleOpenLogFile = async () => {
    if (!window.api) return;
    const p = await window.api.logger.getPath();
    if (p) window.api.system.openPath(p);
  };

  // Cache rescan
  const handleRescan = async () => {
    if (!window.api || rescanning) return;
    setRescanning(true);
    try {
      const [, ] = await Promise.all([
        (async () => { await window.api.mods.invalidateCache(); await refreshMods(); })(),
        new Promise(r => setTimeout(r, 800)),
      ]);
    } finally {
      setRescanning(false);
    }
  };

  const handleLaunch = async () => {
    if (!window.api || isGameRunning) return;
    try { await window.api.game.launch(); } catch (err) { console.error('Launch failed:', err); }
  };

  // Profile handlers
  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    const enabledFilenames = modules.filter(m => m.enabled).map(m => m.filename);
    // 快照所有 UE4SS mod 的 config
    let configSnapshot = null;
    try {
      if (window.api?.mods?.snapshotConfigs) {
        configSnapshot = await window.api.mods.snapshotConfigs();
      }
    } catch { /* ignore */ }
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      enabledModFilenames: enabledFilenames,
      configSnapshot,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    setNewProfileName('');
    persistSetting('profiles', updated);
    addToast(t.toastProfileCreated, 'success');
  };

  const [applyingProfileId, setApplyingProfileId] = useState(null);

  const handleApplyProfile = async (profileId) => {
    if (!window.api || applyingProfileId) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    setApplyingProfileId(profileId);
    try {
      for (const mod of modules) {
        const shouldBeEnabled = profile.enabledModFilenames.includes(mod.filename);
        if (mod.enabled !== shouldBeEnabled) {
          await window.api.mods.toggle(mod.filename);
        }
      }
      try {
        if (profile.configSnapshot && window.api?.mods?.restoreConfigs) {
          await window.api.mods.restoreConfigs(profile.configSnapshot);
        }
      } catch { /* ignore */ }
      await refreshMods();
      setActiveProfileId(profileId);
      persistSetting('activeProfileId', profileId);
      addToast(t.toastProfileApplied, 'success');
    } finally {
      setApplyingProfileId(null);
    }
  };

  const handleDeleteProfile = (profileId) => {
    showConfirm(t.confirmDeleteProfileTitle, t.confirmDeleteProfileDesc, () => {
      const updated = profiles.filter(p => p.id !== profileId);
      setProfiles(updated);
      persistSetting('profiles', updated);
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
        persistSetting('activeProfileId', null);
      }
      addToast(t.toastProfileDeleted, 'warning');
      closeConfirm();
    }, 'danger');
  };

  // ==========================================
  // 9. 計算資料 (Computed Data)
  // ==========================================

  const isProcessing = ue4ssStatus === 'installing' || ue4ssStatus === 'updating';


  // ==========================================
  // 10. 渲染 (Render)
  // ==========================================

  return (
    <div className={`min-h-screen font-sans overflow-hidden flex relative transition-colors duration-700 ease-in-out ${isDark ? 'dark text-slate-200' : 'text-slate-800'}`}>

      {/* Theme transition is now handled by View Transitions API + clip-path */}

      {/* CSS Animations */}
      <style>{`
        ::selection { background: rgba(var(--accent-rgb), 0.3); }

        /* View Transition: disable defaults, JS controls the clip-path animation */
        ::view-transition-old(root),
        ::view-transition-new(root) {
          animation: none;
          mix-blend-mode: normal;
        }
        ::view-transition-old(root) { z-index: 1; }
        ::view-transition-new(root) { z-index: 9999; }
        @keyframes slideUpFade {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDownFade {
          0% { opacity: 0; transform: translateY(-20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes zoomInFade {
          0% { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes toastSlideIn {
          0% { opacity: 0; transform: translateX(100%) scale(0.9); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes modalSpring {
          0% { opacity: 0; transform: scale(0.85) translateY(10px); }
          50% { transform: scale(1.02) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes orbFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(3vw, -2vh) scale(1.05); }
          50% { transform: translate(-1vw, 3vh) scale(0.95); }
          75% { transform: translate(-3vw, -1vh) scale(1.03); }
        }
        @keyframes orbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-4vw, 2vh) scale(1.04); }
          66% { transform: translate(2vw, -3vh) scale(0.97); }
        }
        @keyframes orbFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          20% { transform: translate(2vw, 3vh) scale(1.06); }
          60% { transform: translate(-3vw, -2vh) scale(0.96); }
          80% { transform: translate(1vw, 1vh) scale(1.02); }
        }
        @keyframes shimmerSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes tabFadeIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.995); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes logoBreath {
          0%, 100% { box-shadow: 0 0 15px rgba(var(--accent-rgb),0.3), 0 0 30px rgba(var(--accent-rgb),0.1); transform: scale(1); }
          50% { box-shadow: 0 0 25px rgba(var(--accent-rgb),0.5), 0 0 50px rgba(var(--accent-rgb),0.2); transform: scale(1.05); }
        }
        @keyframes toggleBounce {
          0% { transform: scale(1); }
          40% { transform: scale(1.3); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
        @keyframes ripplePulse {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes countPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes launchRocket {
          0% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-3px) rotate(-5deg); }
          50% { transform: translateY(-6px) rotate(0deg); }
          75% { transform: translateY(-3px) rotate(5deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes langItemIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes emptyBreath {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.08); opacity: 0.6; }
        }
        @keyframes newModPulse {
          0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5); }
          70% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
          100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0); }
        }
        @keyframes circularReveal {
          from { clip-path: circle(0% at var(--cx, 50%) var(--cy, 50%)); }
          to { clip-path: circle(150% at var(--cx, 50%) var(--cy, 50%)); }
        }
        .animate-slide-up { opacity: 0; animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-slide-down { opacity: 0; animation: slideDownFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-zoom-in { opacity: 0; animation: zoomInFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-toast-in { animation: toastSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .animate-modal-spring { animation: modalSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .animate-tab-enter { animation: tabFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .orb-float-1 { animation: orbFloat1 25s ease-in-out infinite; }
        .orb-float-2 { animation: orbFloat2 30s ease-in-out infinite; }
        .orb-float-3 { animation: orbFloat3 22s ease-in-out infinite; }
        .orb-float-4 { animation: orbFloat2 28s ease-in-out infinite reverse; }
        .shimmer-sweep::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
          animation: shimmerSweep 1.2s ease-in-out infinite;
        }
        .logo-breath { animation: logoBreath 3s ease-in-out infinite; }
        .toggle-bounce { animation: toggleBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .count-pop { animation: countPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .launch-hover:hover .launch-icon { animation: launchRocket 0.6s ease-in-out infinite; }
        .launch-hover:hover .launch-glow { animation: ripplePulse 1.5s ease-out infinite; }
        .glass-glow {
          transition: background 0.4s ease;
          background: transparent;
        }
        .glass-glow:hover {
          background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.06) 0%, transparent 60%);
        }
        .dark .glass-glow {
          background: transparent;
        }
        .dark .glass-glow:hover {
          background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.08) 0%, transparent 60%);
        }
      `}</style>

      {/* Background */}
      <div className={`fixed inset-0 pointer-events-none transition-colors duration-1000 -z-20 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`} />

      {/* Floating orbs — 柔和漸層，中間留白，響應式 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className={`absolute top-[-12%] left-[-12%] w-[38vw] h-[38vw] md:w-[32vw] md:h-[32vw] 2xl:w-[38vw] 2xl:h-[38vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-1 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-1)' : 'var(--orb-light-1)' }} />
        <div className={`absolute top-[-8%] right-[-8%] w-[32vw] h-[32vw] md:w-[26vw] md:h-[26vw] 2xl:w-[32vw] 2xl:h-[32vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-2 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-2)' : 'var(--orb-light-2)' }} />
        <div className={`absolute bottom-[-12%] left-[-12%] w-[42vw] h-[42vw] md:w-[35vw] md:h-[35vw] 2xl:w-[42vw] 2xl:h-[42vw] rounded-full blur-[110px] md:blur-[180px] 2xl:blur-[250px] transition-all duration-1000 ease-in-out orb-float-3 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-3)' : 'var(--orb-light-3)' }} />
        <div className={`absolute bottom-[-16%] right-[-8%] w-[34vw] h-[34vw] md:w-[28vw] md:h-[28vw] 2xl:w-[35vw] 2xl:h-[35vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-4 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-4)' : 'var(--orb-light-4)' }} />
      </div>

      {/* Fixed drag bar for Electron title bar */}
      <div className="fixed top-0 left-0 right-0 h-[36px] z-[999] [-webkit-app-region:drag] pointer-events-none" />

      {/* ============ Sidebar ============ */}
      <aside className="w-20 lg:w-64 border-r border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl flex flex-col z-20 transition-colors duration-700 shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
        <div className="h-24 flex items-center justify-center lg:justify-start lg:px-8 border-b border-slate-200/50 dark:border-white/5 transition-colors duration-700 [-webkit-app-region:drag]">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 logo-breath" style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-to))', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}>
            <Biohazard className="text-white w-6 h-6 drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
          </div>
          <h1 className="hidden lg:block ml-4 text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-slate-800 to-slate-500 dark:from-white dark:to-slate-400 transition-colors duration-700">
            HMTZ
          </h1>
        </div>

        <nav ref={navRef} className="flex-1 py-8 flex flex-col gap-3 px-4 [-webkit-app-region:no-drag] relative">
          {/* Sliding indicator */}
          <div
            className="absolute left-6 w-1.5 h-6 rounded-full z-10 pointer-events-none"
            style={{ top: indicatorTop, transition: 'top 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)', backgroundColor: 'var(--accent-500)', boxShadow: '0 0 12px rgba(var(--accent-rgb), 0.5)' }}
          />
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: t.dashboard },
            { id: 'modules', icon: Layers, label: t.modules },
            { id: 'profiles', icon: Save, label: t.profiles },
            { id: 'settings', icon: Settings, label: t.settings },
          ].map((item) => (
            <button
              key={item.id}
              data-tab={item.id}
              onClick={() => { setActiveTab(item.id); setActiveModuleId(null); }}
              className={`flex items-center gap-4 px-4 py-3.5 rounded-full transition-all duration-300 group relative overflow-hidden outline-none focus:outline-none active:outline-none [-webkit-tap-highlight-color:transparent] ${
                activeTab === item.id ? 'border' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent hover:shadow-sm'
              }`}
              style={activeTab === item.id ? { backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: isDark ? 'var(--accent-400)' : 'var(--accent-600)', borderColor: 'rgba(var(--accent-rgb), 0.2)', boxShadow: '0 0 15px rgba(var(--accent-rgb), 0.1)' } : undefined}
            >
              <item.icon className={`w-5 h-5 shrink-0 transition-transform duration-300 ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="hidden lg:block font-medium tracking-wide">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Launch Game button */}
        <div className="px-4 pb-6 [-webkit-app-region:no-drag]">
          <div className="relative w-full group">
            <div className={`absolute -inset-1.5 blur-lg opacity-40 group-hover:opacity-75 animate-pulse transition-all duration-500 rounded-2xl lg:rounded-full pointer-events-none ${isGameRunning ? 'bg-gradient-to-r from-emerald-500 to-green-500' : ''}`} style={!isGameRunning ? { background: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))` } : undefined} />
            <button onClick={handleLaunch} disabled={isGameRunning} className={`launch-hover relative w-full flex items-center justify-center lg:justify-start gap-3 text-white p-3 lg:px-5 lg:py-3.5 rounded-2xl lg:rounded-full transition-all duration-500 overflow-hidden z-10 ${isGameRunning
              ? 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-[0_8px_20px_rgba(16,185,129,0.3)] cursor-default'
              : 'hover:-translate-y-0.5 active:scale-95'}`}
              style={!isGameRunning ? { background: 'linear-gradient(to right, var(--gradient-from), var(--gradient-to))', boxShadow: '0 8px 20px rgba(var(--accent-rgb), 0.3)' } : undefined}>
              <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="launch-glow absolute inset-0 rounded-[inherit] pointer-events-none" style={{ opacity: 0, backgroundColor: 'rgba(var(--accent-rgb), 0.3)' }} />
              {isGameRunning
                ? <CheckCircle className="w-5 h-5 shrink-0 relative z-10" />
                : <Play className="launch-icon w-5 h-5 fill-white shrink-0 relative z-10" />
              }
              <div className="hidden lg:flex flex-1 items-center justify-between min-w-0 relative z-10">
                <span className="font-black tracking-widest text-sm whitespace-nowrap">{isGameRunning ? t.gameRunning : t.launch}</span>
                <span className="font-mono text-[10px] font-bold bg-white/20 text-white/90 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 transition-colors duration-300 group-hover:bg-white/30 group-hover:text-white shadow-inner">
                  {gameVersion?.versionName ? `v${gameVersion.versionName}` : gameVersion?.buildId ? `#${gameVersion.buildId}` : gameVersion?.fileVersion ? `v${gameVersion.fileVersion}` : 'v1.0'}
                </span>
              </div>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-center lg:justify-start gap-2 text-slate-400 dark:text-slate-500 transition-colors duration-700">
          <Settings className="w-4 h-4 rounded-full shrink-0" />
          <span className="hidden lg:block text-[10px] font-mono font-bold tracking-wider truncate">HMTZ Manager v{appVersion || '1.0.0'}</span>
        </div>
      </aside>

      {/* ============ Main Content ============ */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto relative z-10 p-4 pt-16 md:p-8 md:pt-16 md:pl-12 items-center [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80 transition-colors scroll-smooth">

        <div className="absolute top-0 left-0 w-full h-12 [-webkit-app-region:drag]" />

        {/* Header */}
        <header className="w-full max-w-6xl flex justify-between items-center mb-8 z-30 relative animate-slide-down duration-700 select-none [-webkit-app-region:drag]">
          <h2 className="text-2xl font-light text-slate-600 dark:text-slate-400 tracking-wide flex items-center gap-3 transition-colors duration-700">
            <span className="text-slate-400 dark:text-slate-500 font-bold">HMTZ</span>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {activeTab === 'modules' ? t.modules : activeTab === 'dashboard' ? t.dashboard : activeTab === 'profiles' ? t.profiles : t.settings}
            </span>
          </h2>

          <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
            <button
              onClick={() => window.api?.system?.openExternal('https://www.nexusmods.com/humanitz/mods')}
              className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-[var(--accent-50)] dark:hover:bg-[rgba(var(--accent-rgb),0.2)] hover:border-[var(--accent-300)] dark:hover:border-[var(--accent-700)] transition-all hover:scale-105 hover:shadow-md active:scale-95 text-slate-600 dark:text-slate-300 font-bold text-sm cursor-pointer duration-300"
            >
              <ExternalLink className="w-4 h-4" style={{ color: 'var(--accent-500)' }} />
              <span className="hidden sm:inline">Nexus Mods</span>
            </button>
            <div className="relative" ref={langDropdownRef}>
              <button
                onClick={() => setLangDropdownOpen(prev => !prev)}
                className="group relative flex items-center gap-2 px-4 py-2 rounded-full text-slate-600 dark:text-slate-300 font-bold text-sm cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-md active:scale-95"
              >
                <div className="absolute inset-0 rounded-full bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-sm group-hover:bg-[var(--accent-50)] group-hover:dark:bg-[rgba(var(--accent-rgb),0.2)] group-hover:border-[var(--accent-300)] group-hover:dark:border-[var(--accent-700)] transition-colors duration-300" />
                <Globe className="relative w-4 h-4 animate-[spin_10s_linear_infinite]" style={{ color: 'var(--accent-500)' }} />
                <span className="relative hidden sm:inline">{supportedLocales.find(l => l.code === lang)?.name || lang}</span>
                <ChevronDown className={`relative w-3 h-3 transition-transform duration-300 ${langDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {langDropdownOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 min-w-[140px] py-1.5 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-[0_12px_48px_-4px_rgba(0,0,0,0.12),0_4px_16px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_48px_-4px_rgba(0,0,0,0.6),0_4px_16px_-2px_rgba(0,0,0,0.3)] z-50 animate-zoom-in">
                  {supportedLocales.map((locale, i) => (
                    <button
                      key={locale.code}
                      onClick={() => changeLang(locale.code)}
                      style={{ animationDelay: `${i * 40}ms`, ...(locale.code === lang ? { color: isDark ? 'var(--accent-400)' : 'var(--accent-600)' } : {}) }}
                      className={`w-full text-left px-4 py-2 text-sm cursor-pointer flex items-center gap-3 opacity-0 animate-[langItemIn_0.3s_ease_forwards] transition-colors duration-150
                        ${locale.code === lang
                          ? 'font-bold'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                    >
                      {locale.code === lang && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-500)' }} />
                      )}
                      <span className={locale.code === lang ? '' : 'ml-[18px]'}>{locale.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="w-full max-w-6xl flex-1 relative z-10 pb-12">
          <div key={activeTab} className="animate-tab-enter">

          {/* ============ DASHBOARD ============ */}
          {activeTab === 'dashboard' && (
            <div className="flex flex-col gap-4 animate-zoom-in duration-500">

              {/* UE4SS Engine Status */}
              <div className={`
                relative overflow-hidden backdrop-blur-xl border rounded-full py-4 px-6 md:px-8 flex items-center gap-5 shadow-sm transition-all duration-700 hover:shadow-md hover:-translate-y-0.5
                ${isProcessing ? '' :
                  ue4ssStatus === 'uninstalled' ? 'bg-white/60 dark:bg-slate-900/60 border-slate-200 dark:border-white/10' :
                  ue4ssStatus === 'update' ? 'bg-amber-50/80 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50' :
                  'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'
                }
              `}
              style={isProcessing ? { backgroundColor: 'rgba(var(--accent-rgb), 0.05)', borderColor: 'var(--accent-200)' } : undefined}>
                <div className={`
                  w-12 h-12 rounded-full flex items-center justify-center shrink-0 border shadow-inner transition-colors duration-700
                  ${isProcessing ? '' :
                    ue4ssStatus === 'uninstalled' ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400' :
                    ue4ssStatus === 'update' ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-700 text-amber-500 dark:text-amber-400' :
                    'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700 text-emerald-500 dark:text-emerald-400'
                  }
                `}
                style={isProcessing ? { backgroundColor: 'var(--accent-100)', borderColor: 'var(--accent-200)', color: 'var(--accent-500)' } : undefined}>
                  {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Terminal className="w-5 h-5" />}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-1">
                    <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate transition-colors duration-700">{t.engine}</h4>
                    {!isProcessing && (
                      <>
                        {ue4ssStatus === 'uninstalled' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 transition-colors duration-700 shadow-inner">{t.notInstalled}</span>}
                        {ue4ssStatus === 'update' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-300/50 dark:border-amber-700 animate-pulse shrink-0 transition-colors duration-700"><AlertTriangle className="w-3 h-3" /> {t.updateAvailable}</span>}
                        {ue4ssStatus === 'installed' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300/50 dark:border-emerald-700 shrink-0 transition-colors duration-700 shadow-inner"><CheckCircle className="w-3 h-3" /> {t.installed}</span>}
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate transition-colors duration-700">
                    {isProcessing ? t.processing :
                     ue4ssStatus === 'uninstalled' ? t.status_uninstalled :
                     ue4ssStatus === 'update' ? t.status_update : t.status_ok}
                  </p>
                </div>

                <div className="shrink-0 ml-4 hidden sm:flex items-center gap-3 justify-end min-w-[140px]">
                  {isProcessing ? (
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-2.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden shadow-inner relative transition-colors duration-700">
                        <div className="absolute left-0 top-0 bottom-0 transition-all duration-700 ease-out rounded-full shimmer-sweep" style={{ width: `${ue4ssProgress}%`, overflow: 'hidden', background: 'linear-gradient(to right, var(--accent-400), var(--accent-500))' }}>
                          <div className="absolute inset-0 rounded-full" />
                        </div>
                      </div>
                      <span className="text-[11px] font-bold tabular-nums min-w-[2.5rem] text-right" style={{ color: 'var(--accent-500)' }}>{Math.round(ue4ssProgress)}%</span>
                    </div>
                  ) : (
                    <>
                      {ue4ssStatus === 'uninstalled' && (
                        <button onClick={handleUe4ssAction} className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-full transition-all duration-300 shadow-sm hover:shadow-md whitespace-nowrap w-full active:scale-95">
                          <DownloadCloud className="w-3.5 h-3.5" /> {t.deploy}
                        </button>
                      )}
                      {ue4ssStatus === 'update' && (
                        <>
                          {ue4ssVersion && <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 font-mono hidden md:block transition-colors duration-700">{ue4ssVersion}</span>}
                          <button onClick={handleUe4ssAction} className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-full transition-all duration-300 shadow-sm hover:shadow-[0_10px_15px_-3px_rgba(245,158,11,0.3)] whitespace-nowrap active:scale-95"><RefreshCw className="w-3.5 h-3.5" /> {t.update}</button>
                        </>
                      )}
                      {ue4ssStatus === 'installed' && (
                        <div className="flex items-center gap-2 text-[11px] bg-white/50 dark:bg-slate-800/50 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800/50 transition-colors duration-700 shadow-inner">
                          <span className="text-slate-500 dark:text-slate-400 font-bold">{t.version}: <span className="font-mono text-slate-700 dark:text-slate-200">{ue4ssVersion || 'N/A'}</span></span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`
                  group relative overflow-hidden w-full py-8 md:py-10 mt-2 mb-2 rounded-[2.5rem] border-2 border-dashed flex flex-col items-center justify-center transition-all duration-500 cursor-pointer
                  ${isDragging
                    ? 'scale-[1.01]'
                    : 'bg-white/40 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700 hover:bg-white/60 dark:hover:bg-slate-800/60'
                  }
                `}
                style={isDragging
                  ? { backgroundColor: 'rgba(var(--accent-rgb), 0.05)', borderColor: 'var(--accent-500)', boxShadow: '0 0 30px rgba(var(--accent-rgb), 0.15)' }
                  : undefined
                }
                onMouseEnter={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = 'var(--accent-400)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.1)'; } }}
                onMouseLeave={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; } }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  accept=".zip,.rar,.pak"
                  onChange={async (e) => {
                    if (e.target.files && e.target.files.length > 0 && window.api) {
                      const paths = Array.from(e.target.files).map(f => f.path).filter(Boolean);
                      if (paths.length > 0) {
                        await window.api.mods.install(paths);
                        addToast(t.toastInstalled, 'success');
                      }
                    }
                    e.target.value = null;
                  }}
                />

                <button
                  onClick={(e) => { e.stopPropagation(); handleImportFiles(); }}
                  className="absolute top-4 right-4 md:top-5 md:right-6 flex items-center gap-1.5 px-3 py-1.5 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-full border border-slate-200/60 dark:border-slate-600/60 shadow-sm transition-all duration-300 hover:-translate-y-0.5 active:scale-95 z-10"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.05)'; e.currentTarget.style.color = 'var(--accent-600)'; e.currentTarget.style.borderColor = 'var(--accent-300)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  {t.importMod}
                </button>

                <div className={`p-4 rounded-full mb-3 transition-all duration-500 shadow-sm group-hover:scale-110 ${isDragging ? 'text-white animate-bounce' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  style={isDragging ? { backgroundColor: 'var(--accent-500)' } : undefined}
>
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h4 className={`text-lg font-bold transition-colors duration-500 ${isDragging ? '' : 'text-slate-700 dark:text-slate-200'}`}
                  style={isDragging ? { color: 'var(--accent-600)' } : undefined}>
                  {isDragging ? t.dropzoneActive : t.dropzoneTitle}
                </h4>
                <p className={`text-xs font-medium mt-1 transition-colors duration-500 ${isDragging ? '' : 'text-slate-500 dark:text-slate-400'}`}
                  style={isDragging ? { color: 'rgba(var(--accent-rgb), 0.8)' } : undefined}>
                  {t.dropzoneDesc}
                </p>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-full py-4 px-6 md:px-8 shadow-sm flex items-center justify-between transition-all duration-700 hover:shadow-md hover:-translate-y-0.5 group">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/50 rounded-full text-indigo-500 dark:text-indigo-400 shadow-inner transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6"><Package className="w-5 h-5"/></div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors duration-700">{t.pakTitle}</h4>
                  </div>
                  <div className="text-2xl font-black text-slate-700 dark:text-slate-100 transition-colors duration-700"><AnimatedNumber value={modules.filter(m => m.type === 'PAK').length} /> <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1 transition-colors duration-700">{t.installed}</span></div>
                </div>
                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-full py-4 px-6 md:px-8 shadow-sm flex items-center justify-between transition-all duration-700 hover:shadow-md hover:-translate-y-0.5 group">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-rose-100 dark:bg-rose-900/50 rounded-full text-rose-500 dark:text-rose-400 shadow-inner transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"><Terminal className="w-5 h-5"/></div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors duration-700">{t.ue4ssTitle}</h4>
                  </div>
                  <div className="text-2xl font-black text-slate-700 dark:text-slate-100 transition-colors duration-700"><AnimatedNumber value={modules.filter(m => m.type === 'UE4SS').length} /> <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1 transition-colors duration-700">{t.installed}</span></div>
                </div>
              </div>

            </div>
          )}

          {/* ============ MODULES (Library) ============ */}
          {activeTab === 'modules' && (
            <div className="flex flex-col gap-2 w-full animate-slide-up">
              {modules.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 gap-3">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', animation: 'emptyBreath 3s ease-in-out infinite' }} />
                    <Package className="relative w-14 h-14 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
                  </div>
                  <h3 className="text-lg font-bold animate-slide-up" style={{ animationDelay: '100ms' }}>{t.noMods}</h3>
                  <p className="text-sm animate-slide-up" style={{ animationDelay: '200ms' }}>{t.noModsDesc}</p>
                </div>
              ) : (
                <>
                  <ModuleList
                    modules={modules}
                    type="PAK"
                    title={t.pakTitle}
                    icon={Package}
                    colorClass="text-indigo-600 dark:text-indigo-400"
                    activeModuleId={activeModuleId}
                    onModuleClick={handleModuleClick}
                    onToggle={handleToggleEnable}
                    onUninstallLocal={handleUninstallLocalMod}
                    onOpenConfig={setConfigEditorMod}
                    t={t}
                    lang={lang}
                    newlyInstalledMods={newlyInstalledMods}
                  />
                  {modules.some(m => m.type === 'PAK') && modules.some(m => m.type === 'UE4SS') && (
                    <div className="w-full h-px bg-slate-200/60 dark:bg-white/10 my-4 rounded-full transition-colors duration-700" />
                  )}
                  <ModuleList
                    modules={modules}
                    type="UE4SS"
                    title={t.ue4ssTitle}
                    icon={Terminal}
                    colorClass="text-rose-600 dark:text-rose-400"
                    activeModuleId={activeModuleId}
                    onModuleClick={handleModuleClick}
                    onToggle={handleToggleEnable}
                    onUninstallLocal={handleUninstallLocalMod}
                    onOpenConfig={setConfigEditorMod}
                    t={t}
                    lang={lang}
                    newlyInstalledMods={newlyInstalledMods}
                  />
                </>
              )}
            </div>
          )}

          {/* ============ PROFILES ============ */}
          {activeTab === 'profiles' && (
            <div className="flex flex-col gap-4 w-full animate-slide-up duration-500">
              <div className="flex items-center gap-3 mb-2 px-4">
                <div className="p-2 rounded-full shadow-inner transition-colors duration-700" style={{ backgroundColor: 'var(--accent-100)', color: 'var(--accent-500)' }}>
                  <Save className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-wide transition-colors duration-700">{t.profiles}</h3>
                <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold transition-colors duration-700 shadow-inner">{profiles.length}</span>
              </div>

              {/* Create new profile */}
              <div className="px-2">
                <GlassCard isPill={false} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-5 py-4 md:px-6 md:py-5">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="p-2.5 rounded-full shadow-inner shrink-0" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 transition-colors duration-700">{t.saveAsProfile}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">{t.currentConfig}: {modules.filter(m => m.enabled).length} {t.profileModCount}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-slate-950/40 p-1.5 rounded-full border border-slate-200/50 dark:border-slate-800/50 shadow-inner transition-colors duration-500">
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                      placeholder={t.profilePlaceholder}
                      className="w-full sm:w-40 lg:w-52 px-4 py-2 text-xs rounded-full bg-transparent text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all font-medium focus:bg-white/50 dark:focus:bg-slate-900/50"
                    />
                    <button
                      onClick={handleCreateProfile}
                      disabled={!newProfileName.trim()}
                      className="px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      style={{ backgroundColor: 'var(--accent-500)' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = `0 10px 15px -3px rgba(var(--accent-rgb), 0.3)`; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}
                    >
                      {t.newProfile}
                    </button>
                  </div>
                </GlassCard>
              </div>

              {/* Profile list */}
              {profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-4">
                    <Save className="w-10 h-10" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-500 dark:text-slate-400 mb-1">{t.noProfiles}</h4>
                  <p className="text-sm text-slate-400 dark:text-slate-500">{t.createFirstProfile}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 px-2">
                  {profiles.map((profile, index) => {
                    const enabledCount = (profile.enabledModFilenames || []).length;
                    const isActive = activeProfileId === profile.id;
                    return (
                      <div
                        key={profile.id}
                        className="animate-slide-up"
                        style={{ animationFillMode: 'both', animationDelay: `${index * 60}ms`, animationDuration: '600ms' }}
                      >
                        <GlassCard className={`group flex flex-col sm:flex-row items-start sm:items-center px-4 py-3 md:px-5 md:py-3.5 gap-3 relative ${isActive ? 'ring-2 bg-white/80 dark:bg-slate-800/80 shadow-[0_8px_24px_rgba(0,0,0,0.08)]' : ''}`}
                          style={isActive ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)' } : undefined}>
                          <div className={`p-2.5 rounded-full shrink-0 transition-all duration-500 shadow-sm ${isActive ? '' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'} group-hover:scale-110`}
                            style={isActive ? { backgroundColor: 'var(--accent-100)', color: 'var(--accent-500)' } : undefined}>
                            <Save className="w-5 h-5" />
                          </div>

                          <div className="flex flex-col flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700 ">{profile.name}</h4>
                              {isActive && (
                                <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border" style={{ backgroundColor: 'var(--accent-100)', color: 'var(--accent-600)', borderColor: 'rgba(var(--accent-rgb), 0.2)' }}>
                                  <CheckCircle className="w-2.5 h-2.5" /> {t.activeProfile}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">
                              {enabledCount} {t.profileModCount} · {profile.createdAt}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleApplyProfile(profile.id); }}
                              disabled={!!applyingProfileId}
                              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 shadow-sm ${
                                isActive
                                  ? 'text-white'
                                  : 'bg-slate-800 dark:bg-slate-700 text-white'
                              } ${applyingProfileId === profile.id ? 'opacity-80 pointer-events-none' : ''}`}
                              style={isActive ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 6px -1px rgba(var(--accent-rgb), 0.3)' } : undefined}
                              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; } }}
                              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.boxShadow = ''; } }}
                            >
                              {applyingProfileId === profile.id
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <Play className="w-3 h-3 fill-white" />
                              } {t.applyProfile}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                              className="p-2 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </GlassCard>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============ SETTINGS ============ */}
          {activeTab === 'settings' && (
            <div className="flex flex-col gap-4 w-full">
              <div className="flex items-center gap-3 mb-3 px-4 animate-slide-up duration-500">
                <div className="p-2 rounded-full bg-slate-200/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 shadow-inner transition-colors duration-700">
                  <Settings className="w-5 h-5 animate-[spin_6s_linear_infinite]" />
                </div>
                <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-wide transition-colors duration-700">{lang === 'zh-TW' ? '系統' : ''}{t.settings}</h3>
              </div>

              <div className="flex flex-col gap-3 px-2">

                {/* Dark mode toggle */}
                <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '0ms', animationDuration: '600ms' }}>
                  <GlassCard
                    onClick={toggleDark}
                    className="group flex flex-row items-center px-4 py-2 md:px-5 md:py-2.5 gap-4 relative"
                  >
                    <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110 group-hover:-rotate-12"
                      style={{ backgroundColor: isDark ? 'rgba(var(--accent-rgb), 0.15)' : 'var(--accent-100)', borderColor: isDark ? 'rgba(var(--accent-rgb), 0.3)' : 'var(--accent-200)', color: isDark ? 'var(--accent-400)' : 'var(--accent-500)' }}>
                      {isDark ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 transition-opacity duration-300">
                      <div className="flex items-center gap-3 mb-0.5">
                        <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.appearance}</h4>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 leading-none transition-colors duration-700 shadow-inner">
                          {isDark ? t.darkMode : t.lightMode}
                        </span>
                      </div>
                      <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.appearanceDesc}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleDark(); }}
                        className="relative flex items-center w-16 h-8 md:w-20 md:h-9 bg-slate-200/80 dark:bg-slate-950/60 rounded-full p-1 shadow-inner transition-colors duration-500 hover:scale-105 active:scale-95"
                      >
                        <div
                          className={`absolute top-1 bottom-1 w-[28px] md:w-[36px] bg-white dark:bg-slate-700 rounded-full shadow-md transition-transform duration-500 ${isDark ? 'translate-x-[28px] md:translate-x-[36px]' : 'translate-x-0'}`}
                          style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        />
                        <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${!isDark ? '' : 'text-slate-400 dark:text-slate-600'}`}
                          style={!isDark ? { color: 'var(--accent-500)' } : undefined}><Sun className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
                        <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${isDark ? 'text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}><Moon className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
                      </button>
                    </div>
                  </GlassCard>
                </div>

                {/* Theme selector */}
                <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '50ms', animationDuration: '600ms' }}>
                  <GlassCard isPill={false} className="group flex flex-col px-4 py-3 md:px-5 md:py-3.5 gap-3 relative">
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-xl border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110"
                        style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', borderColor: 'rgba(var(--accent-rgb), 0.2)', color: 'var(--accent-500)' }}>
                        <Sliders className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.theme}</h4>
                        <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.themeDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-around gap-3 px-2 py-1">
                      {THEME_PRESETS.map(preset => {
                        const isActive = themeId === preset.id;
                        const label = t[`theme${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}`] || preset.id;
                        return (
                          <button
                            key={preset.id}
                            onClick={(e) => changeTheme(preset.id, e)}
                            className={`flex flex-col items-center gap-2 px-3 py-2 rounded-2xl transition-all duration-300 active:scale-90 ${isActive ? 'bg-white/80 dark:bg-slate-800/80 shadow-md scale-105' : 'hover:bg-white/40 dark:hover:bg-slate-800/40 hover:scale-105'}`}
                          >
                            <div
                              className={`w-8 h-8 rounded-lg transition-all duration-300 shadow-sm ${isActive ? 'scale-110' : 'hover:scale-110'}`}
                              style={{
                                background: `linear-gradient(135deg, ${preset.accent[400]}, ${preset.gradient.to})`,
                                boxShadow: isActive ? `0 0 0 2.5px ${isDark ? '#0f172a' : '#fff'}, 0 0 0 4.5px ${preset.accent[500]}` : undefined
                              }}
                            />
                            <span className={`text-xs font-bold tracking-wide transition-colors duration-300 ${isActive ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </GlassCard>
                </div>

                {/* Game path */}
                <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '150ms', animationDuration: '600ms' }}>
                  <GlassCard className="group flex flex-row items-center px-4 py-2 md:px-5 md:py-2.5 gap-2 md:gap-4 relative">
                    <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm bg-sky-100 border-sky-200 text-sky-500 dark:bg-sky-900/50 dark:border-sky-700 dark:text-sky-400 group-hover:scale-110 group-hover:rotate-6">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 transition-opacity duration-300">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.gamePath}</h4>
                      </div>
                      <p className="text-[10px] md:text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.gamePathDesc}</p>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                      <input
                        type="text"
                        value={gamePath || ''}
                        readOnly
                        placeholder={t.gamePathPlaceholder || '...'}
                        className="w-16 sm:w-28 md:w-48 px-3 py-1.5 text-[10px] md:text-xs rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-inner font-mono truncate hover:bg-white/80 dark:hover:bg-slate-900/80"
                      />
                      <button
                        onClick={handleDetectPath}
                        disabled={detecting}
                        className={`px-2.5 md:px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-full transition-all duration-300 shadow-sm flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 active:scale-95 hover:shadow-md ${detecting ? 'opacity-70 pointer-events-none' : ''}`}
                        title={t.gamePathDetect}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 transition-transform ${detecting ? 'animate-spin' : ''}`} />
                        <span className="hidden lg:inline ml-1.5">{t.gamePathDetect}</span>
                      </button>
                      <button onClick={handleBrowsePath} className="px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-full transition-all duration-300 shadow-sm flex items-center justify-center min-w-[3.5rem] md:min-w-[4rem] bg-slate-800 dark:bg-slate-700 text-white hover:bg-sky-500 dark:hover:bg-sky-500 active:scale-95 hover:shadow-[0_10px_15px_-3px_rgba(14,165,233,0.3)]">
                        {t.gamePathBrowse}
                      </button>
                    </div>
                  </GlassCard>
                </div>

                {/* Tools row: Conflict Scan + View Logs + Rescan Mods */}
                <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '250ms', animationDuration: '600ms' }}>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleConflictScan} className="flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-600 dark:hover:text-amber-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
                      <AlertTriangle className="w-4 h-4" /> {t.conflictScan}
                    </button>
                    <button onClick={handleOpenLogs} className="flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:border-sky-300 dark:hover:border-sky-700 hover:text-sky-600 dark:hover:text-sky-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
                      <FileText className="w-4 h-4" /> {t.viewLogs}
                    </button>
                    <button onClick={handleRescan} disabled={rescanning} className={`flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-300 dark:hover:border-violet-700 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md ${rescanning ? 'opacity-70 pointer-events-none' : ''}`}>
                      <RefreshCw className={`w-4 h-4 ${rescanning ? 'animate-spin' : ''}`} /> {rescanning ? t.rescanning : t.rescanMods}
                    </button>
                  </div>
                </div>

                {/* About / Update */}
                <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '350ms', animationDuration: '600ms' }}>
                  <GlassCard isPill={!(updateState === 'available' && updateInfo?.changelog)} className="flex flex-col px-4 py-3 md:px-5 md:py-4 gap-3 relative">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                        <Info className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-0.5">
                          <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.about}</h4>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shadow-inner">v{appVersion || '1.0.0'}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">HZMM — HumanitZ Mod Manager</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {updateState === 'idle' && (
                          <button onClick={handleCheckUpdate} className="px-4 py-2 text-xs font-bold rounded-full bg-slate-800 dark:bg-slate-700 text-white transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md"
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
                            {t.checkUpdate}
                          </button>
                        )}
                        {updateState === 'checking' && (
                          <span className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t.checking}
                          </span>
                        )}
                        {updateState === 'latest' && (
                          <span className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-full border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle className="w-3.5 h-3.5" /> {t.latestVersion}
                          </span>
                        )}
                        {updateState === 'available' && (
                          <button onClick={handleDownloadUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm" style={{ backgroundColor: 'var(--accent-500)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}>
                            <DownloadCloud className="w-3.5 h-3.5" /> {t.downloadUpdate}
                          </button>
                        )}
                        {updateState === 'downloading' && (
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-2 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden shadow-inner">
                              <div className="h-full transition-all duration-500 ease-out rounded-full shimmer-sweep" style={{ background: 'linear-gradient(to right, var(--accent-400), var(--accent-500))', width: `${updateProgress}%` }} />
                            </div>
                            <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--accent-500)' }}>{Math.round(updateProgress)}%</span>
                          </div>
                        )}
                        {updateState === 'ready' && (
                          <button onClick={handleInstallUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
                            <Zap className="w-3.5 h-3.5" /> {t.installUpdate}
                          </button>
                        )}
                      </div>
                    </div>
                    {updateState === 'available' && updateInfo?.changelog && (
                      <div className="mt-1 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/60 dark:border-slate-700/50 overflow-hidden">
                      <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed max-h-28 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
                        <p className="font-bold text-slate-600 dark:text-slate-300 mb-1.5">{t.newVersion}: {updateInfo.latestVersion.startsWith('v') ? updateInfo.latestVersion : `v${updateInfo.latestVersion}`}</p>
                        {updateInfo.changelog.split('\n').map((line, i) => {
                          const trimmed = line.trim();
                          if (!trimmed) return null;
                          if (trimmed.startsWith('## ')) return <p key={i} className="font-bold text-slate-600 dark:text-slate-300 mt-1.5 mb-0.5">{trimmed.replace('## ', '')}</p>;
                          if (trimmed.startsWith('- ')) return <p key={i} className="pl-2">• {trimmed.replace('- ', '')}</p>;
                          return <p key={i}>{trimmed}</p>;
                        })}
                      </div>
                      </div>
                    )}
                  </GlassCard>
                </div>

              </div>
            </div>
          )}

          </div>
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Confirm modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        description={confirmModal.description}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirm}
        t={t}
        confirmVariant={confirmModal.variant}
      />

      <ConfigEditorModal
        isOpen={!!configEditorMod}
        mod={configEditorMod}
        onClose={() => setConfigEditorMod(null)}
        t={t}
        lang={lang}
        addToast={addToast}
      />

      {/* Conflict Scan Modal */}
      {conflictModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={() => setConflictModalOpen(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-modal-spring">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" /> {t.conflictScan}
              </h3>
              <button onClick={() => setConflictModalOpen(false)} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {conflictScanning ? (
                <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
                  <p className="text-sm font-medium">{t.conflictScanning}</p>
                </div>
              ) : conflicts && conflicts.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-emerald-500">
                  <CheckCircle className="w-10 h-10" />
                  <p className="text-sm font-bold">{t.conflictNone}</p>
                </div>
              ) : conflicts && conflicts.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-bold text-amber-600 dark:text-amber-400">{conflicts.length} {t.conflictFound}</p>
                  {conflicts.map((c, i) => (
                    <div key={i} className="bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40 rounded-xl px-4 py-3">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">{t.conflictResource}: <span className="font-mono text-amber-600 dark:text-amber-400">{c.resource}</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.mods.map((m, j) => (
                          <span key={j} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{m}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Log Viewer Modal */}
      {logModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={() => setLogModalOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-modal-spring">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FileText className="w-5 h-5 text-sky-500" /> {t.viewLogs}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={handleOpenLogFile} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-600 dark:hover:text-sky-400 transition-colors border border-slate-200 dark:border-slate-700">
                  <ExternalLink className="w-3 h-3" /> {t.openLogFile}
                </button>
                <button onClick={() => setLogModalOpen(false)} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {logLoading ? (
                <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <p className="text-sm font-medium">{t.logLoading}</p>
                </div>
              ) : logLines && logLines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                  <FileText className="w-8 h-8" />
                  <p className="text-sm font-medium">{t.logEmpty}</p>
                </div>
              ) : logLines ? (
                <div className="bg-slate-950 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto">
                  {logLines.map((line, i) => (
                    <div key={i} className={`py-0.5 ${line.includes('ERROR') || line.includes('error') ? 'text-red-400' : line.includes('WARN') || line.includes('warn') ? 'text-amber-400' : ''}`}>
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
