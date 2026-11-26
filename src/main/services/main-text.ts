// Text the main process shows itself: the tray menu and native file dialogs.
// Everything the renderer shows lives in src/renderer/src/constants/i18n;
// these few strings are needed before (or without) a window, so they stay
// here, keyed by the same locale codes.

export interface MainText {
  trayShow: string
  trayQuit: string
  modFiles: string
  allFiles: string
  ue4ssZipTitle: string
  ue4ssZipFilter: string
  /** Native error box when startup throws; the error and the log path follow it. */
  startupFailed: string
}

const TEXT: Record<string, MainText> = {
  'zh-TW': {
    trayShow: '顯示 HZMM',
    trayQuit: '結束',
    modFiles: '模組檔案',
    allFiles: '所有檔案',
    ue4ssZipTitle: '選擇 UE4SS 壓縮檔',
    ue4ssZipFilter: 'UE4SS 壓縮檔 (*.zip)',
    startupFailed: 'HZMM 無法啟動。以下是錯誤內容，記錄檔裡有更多細節：'
  },
  en: {
    trayShow: 'Show HZMM',
    trayQuit: 'Quit',
    modFiles: 'Mod Files',
    allFiles: 'All Files',
    ue4ssZipTitle: 'Select UE4SS zip',
    ue4ssZipFilter: 'UE4SS archive (*.zip)',
    startupFailed: "HZMM couldn't start. The error is below; the log file has more detail:"
  },
  ja: {
    trayShow: 'HZMM を表示',
    trayQuit: '終了',
    modFiles: 'MODファイル',
    allFiles: 'すべてのファイル',
    ue4ssZipTitle: 'UE4SS の zip を選択',
    ue4ssZipFilter: 'UE4SS アーカイブ (*.zip)',
    startupFailed: 'HZMM を起動できませんでした。エラー内容は以下のとおりです。詳細はログファイルにあります：'
  },
  ko: {
    trayShow: 'HZMM 열기',
    trayQuit: '종료',
    modFiles: '모드 파일',
    allFiles: '모든 파일',
    ue4ssZipTitle: 'UE4SS zip 선택',
    ue4ssZipFilter: 'UE4SS 압축 파일 (*.zip)',
    startupFailed: 'HZMM을 시작할 수 없습니다. 오류 내용은 아래와 같으며, 자세한 내용은 로그 파일에 있습니다:'
  },
  ru: {
    trayShow: 'Показать HZMM',
    trayQuit: 'Выход',
    modFiles: 'Файлы модов',
    allFiles: 'Все файлы',
    ue4ssZipTitle: 'Выберите zip-архив UE4SS',
    ue4ssZipFilter: 'Архив UE4SS (*.zip)',
    startupFailed: 'Не удалось запустить HZMM. Ошибка приведена ниже, подробности — в файле журнала:'
  },
  de: {
    trayShow: 'HZMM anzeigen',
    trayQuit: 'Beenden',
    modFiles: 'Mod-Dateien',
    allFiles: 'Alle Dateien',
    ue4ssZipTitle: 'UE4SS-ZIP auswählen',
    ue4ssZipFilter: 'UE4SS-Archiv (*.zip)',
    startupFailed: 'HZMM konnte nicht gestartet werden. Der Fehler steht unten, weitere Details in der Logdatei:'
  },
  fr: {
    trayShow: 'Afficher HZMM',
    trayQuit: 'Quitter',
    modFiles: 'Fichiers de mod',
    allFiles: 'Tous les fichiers',
    ue4ssZipTitle: "Choisir le zip d'UE4SS",
    ue4ssZipFilter: 'Archive UE4SS (*.zip)',
    startupFailed: "HZMM n'a pas pu démarrer. L'erreur est indiquée ci-dessous ; le fichier journal contient plus de détails :"
  }
}

export function mainText(locale: string): MainText {
  return TEXT[locale] ?? TEXT.en
}
