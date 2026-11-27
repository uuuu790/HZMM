// Text the main process shows itself: the tray menu and native file dialogs.
// Everything the renderer shows lives in src/renderer/src/constants/i18n;
// these few strings are needed before (or without) a window, so they stay
// here, keyed by the same locale codes.
import type { ReportSectionKey } from '../ipc/types'

export interface MainText {
  trayShow: string
  trayQuit: string
  modFiles: string
  allFiles: string
  ue4ssZipTitle: string
  ue4ssZipFilter: string
  /** Native error box when startup throws; the error and the log path follow it. */
  startupFailed: string
  // Problem report from the startup error box (native dialogs, no window).
  reportSendButton: string
  closeButton: string
  reportViewButton: string
  reportCancelButton: string
  reportConfirm: string
  /** {parts}: one section title per line; {size}: the report's size. */
  reportConfirmDetail: string
  reportViewHint: string
  reportSent: string
  /** {id}: the inbox's report id. */
  reportSentDetail: string
  reportNotSent: string
  /** {path}: where the report file was saved. */
  reportSavedHint: string
  /** Section headings, also used in a saved report file. */
  reportSections: Record<ReportSectionKey, string>
  reportNoteTitle: string
  reportNexusName: string
}

const TEXT: Record<string, MainText> = {
  'zh-TW': {
    trayShow: '顯示 HZMM',
    trayQuit: '結束',
    modFiles: '模組檔案',
    allFiles: '所有檔案',
    ue4ssZipTitle: '選擇 UE4SS 壓縮檔',
    ue4ssZipFilter: 'UE4SS 壓縮檔 (*.zip)',
    startupFailed: 'HZMM 無法啟動。以下是錯誤內容，記錄檔裡有更多細節：',
    reportSendButton: '傳送回報',
    closeButton: '關閉',
    reportViewButton: '查看內容',
    reportCancelButton: '取消',
    reportConfirm: '要把這份問題回報傳給 HZMM 作者嗎？',
    reportConfirmDetail: '會傳送：\n{parts}\n\n大小約 {size}。路徑裡的 Windows 使用者名稱已經遮掉；Nexus API 金鑰和遊戲存檔一律不傳。',
    reportViewHint: '按「查看內容」可以先看完整內容。',
    reportSent: '回報已送出',
    reportSentDetail: '回報編號：{id}\n在 Nexus 留言時附上這個編號，作者就能找到你的回報。',
    reportNotSent: '回報沒有送出',
    reportSavedHint: '回報已存成檔案：\n{path}\n可以把這個檔案附在 Nexus 的留言裡。',
    reportSections: {
      context: '錯誤內容',
      app: 'HZMM 與 Windows',
      hw: '硬體',
      disk: '暫存區與 HZMM 的位置',
      av: '防毒軟體',
      game: '遊戲與 UE4SS',
      mods: '已安裝的模組',
      log: 'HZMM 記錄檔（最近 1000 行）'
    },
    reportNoteTitle: '狀況說明',
    reportNexusName: 'Nexus 名稱'
  },
  en: {
    trayShow: 'Show HZMM',
    trayQuit: 'Quit',
    modFiles: 'Mod Files',
    allFiles: 'All Files',
    ue4ssZipTitle: 'Select UE4SS zip',
    ue4ssZipFilter: 'UE4SS archive (*.zip)',
    startupFailed: "HZMM couldn't start. The error is below; the log file has more detail:",
    reportSendButton: 'Send a report',
    closeButton: 'Close',
    reportViewButton: 'View contents',
    reportCancelButton: 'Cancel',
    reportConfirm: 'Send this problem report to the HZMM author?',
    reportConfirmDetail: 'It contains:\n{parts}\n\nAbout {size}. Your Windows user name is masked out of paths; your Nexus API key and game saves are never sent.',
    reportViewHint: 'Choose "View contents" to read the whole report first.',
    reportSent: 'Report sent',
    reportSentDetail: 'Report ID: {id}\nMention this ID when you post on Nexus so the author can find your report.',
    reportNotSent: "The report wasn't sent",
    reportSavedHint: 'The report was saved as a file:\n{path}\nYou can attach this file to a post on Nexus.',
    reportSections: {
      context: 'Error',
      app: 'HZMM and Windows',
      hw: 'Hardware',
      disk: 'Temp folder and HZMM location',
      av: 'Antivirus',
      game: 'Game and UE4SS',
      mods: 'Installed mods',
      log: 'HZMM log (last 1000 lines)'
    },
    reportNoteTitle: 'What happened',
    reportNexusName: 'Nexus name'
  },
  ja: {
    trayShow: 'HZMM を表示',
    trayQuit: '終了',
    modFiles: 'MODファイル',
    allFiles: 'すべてのファイル',
    ue4ssZipTitle: 'UE4SS の zip を選択',
    ue4ssZipFilter: 'UE4SS アーカイブ (*.zip)',
    startupFailed: 'HZMM を起動できませんでした。エラー内容は以下のとおりです。詳細はログファイルにあります：',
    reportSendButton: 'レポートを送信',
    closeButton: '閉じる',
    reportViewButton: '内容を確認',
    reportCancelButton: 'キャンセル',
    reportConfirm: 'この問題レポートを HZMM の作者に送信しますか？',
    reportConfirmDetail: '送信する内容：\n{parts}\n\nサイズは約 {size} です。パスに含まれる Windows のユーザー名は伏せてあります。Nexus の API キーとゲームのセーブデータは送信されません。',
    reportViewHint: '「内容を確認」で、送信前にレポート全体を確認できます。',
    reportSent: 'レポートを送信しました',
    reportSentDetail: 'レポート ID：{id}\nNexus に投稿するときにこの ID を書き添えると、作者がレポートを見つけられます。',
    reportNotSent: 'レポートを送信できませんでした',
    reportSavedHint: 'レポートをファイルに保存しました：\n{path}\nこのファイルを Nexus の投稿に添付できます。',
    reportSections: {
      context: 'エラー内容',
      app: 'HZMM と Windows',
      hw: 'ハードウェア',
      disk: '一時フォルダーと HZMM の場所',
      av: 'ウイルス対策ソフト',
      game: 'ゲームと UE4SS',
      mods: 'インストール済みの MOD',
      log: 'HZMM のログ（直近 1000 行）'
    },
    reportNoteTitle: '状況の説明',
    reportNexusName: 'Nexus の名前'
  },
  ko: {
    trayShow: 'HZMM 열기',
    trayQuit: '종료',
    modFiles: '모드 파일',
    allFiles: '모든 파일',
    ue4ssZipTitle: 'UE4SS zip 선택',
    ue4ssZipFilter: 'UE4SS 압축 파일 (*.zip)',
    startupFailed: 'HZMM을 시작할 수 없습니다. 오류 내용은 아래와 같으며, 자세한 내용은 로그 파일에 있습니다:',
    reportSendButton: '보고서 보내기',
    closeButton: '닫기',
    reportViewButton: '내용 보기',
    reportCancelButton: '취소',
    reportConfirm: '이 문제 보고서를 HZMM 제작자에게 보낼까요?',
    reportConfirmDetail: '보낼 내용:\n{parts}\n\n크기는 약 {size}입니다. 경로에 있는 Windows 사용자 이름은 가려지며, Nexus API 키와 게임 저장 파일은 보내지 않습니다.',
    reportViewHint: '"내용 보기"를 누르면 보내기 전에 보고서 전체를 확인할 수 있습니다.',
    reportSent: '보고서를 보냈습니다',
    reportSentDetail: '보고서 ID: {id}\nNexus에 글을 남길 때 이 ID를 함께 적으면 제작자가 보고서를 찾을 수 있습니다.',
    reportNotSent: '보고서를 보내지 못했습니다',
    reportSavedHint: '보고서를 파일로 저장했습니다:\n{path}\n이 파일을 Nexus 게시글에 첨부할 수 있습니다.',
    reportSections: {
      context: '오류 내용',
      app: 'HZMM 및 Windows',
      hw: '하드웨어',
      disk: '임시 폴더와 HZMM 위치',
      av: '백신 프로그램',
      game: '게임 및 UE4SS',
      mods: '설치된 모드',
      log: 'HZMM 로그 (최근 1000줄)'
    },
    reportNoteTitle: '상황 설명',
    reportNexusName: 'Nexus 이름'
  },
  ru: {
    trayShow: 'Показать HZMM',
    trayQuit: 'Выход',
    modFiles: 'Файлы модов',
    allFiles: 'Все файлы',
    ue4ssZipTitle: 'Выберите zip-архив UE4SS',
    ue4ssZipFilter: 'Архив UE4SS (*.zip)',
    startupFailed: 'Не удалось запустить HZMM. Ошибка приведена ниже, подробности — в файле журнала:',
    reportSendButton: 'Отправить отчёт',
    closeButton: 'Закрыть',
    reportViewButton: 'Посмотреть',
    reportCancelButton: 'Отмена',
    reportConfirm: 'Отправить этот отчёт о проблеме автору HZMM?',
    reportConfirmDetail: 'В отчёте:\n{parts}\n\nРазмер — около {size}. Имя пользователя Windows в путях скрыто; ключ API Nexus и сохранения игры никогда не отправляются.',
    reportViewHint: 'Нажмите «Посмотреть», чтобы сначала прочитать отчёт целиком.',
    reportSent: 'Отчёт отправлен',
    reportSentDetail: 'Номер отчёта: {id}\nУкажите этот номер, когда будете писать на Nexus, — так автор найдёт ваш отчёт.',
    reportNotSent: 'Отчёт не отправлен',
    reportSavedHint: 'Отчёт сохранён в файл:\n{path}\nЭтот файл можно приложить к сообщению на Nexus.',
    reportSections: {
      context: 'Ошибка',
      app: 'HZMM и Windows',
      hw: 'Оборудование',
      disk: 'Временная папка и расположение HZMM',
      av: 'Антивирус',
      game: 'Игра и UE4SS',
      mods: 'Установленные моды',
      log: 'Журнал HZMM (последние 1000 строк)'
    },
    reportNoteTitle: 'Что произошло',
    reportNexusName: 'Имя на Nexus'
  },
  de: {
    trayShow: 'HZMM anzeigen',
    trayQuit: 'Beenden',
    modFiles: 'Mod-Dateien',
    allFiles: 'Alle Dateien',
    ue4ssZipTitle: 'UE4SS-ZIP auswählen',
    ue4ssZipFilter: 'UE4SS-Archiv (*.zip)',
    startupFailed: 'HZMM konnte nicht gestartet werden. Der Fehler steht unten, weitere Details in der Logdatei:',
    reportSendButton: 'Bericht senden',
    closeButton: 'Schließen',
    reportViewButton: 'Inhalt ansehen',
    reportCancelButton: 'Abbrechen',
    reportConfirm: 'Diesen Problembericht an den Autor von HZMM senden?',
    reportConfirmDetail: 'Enthalten:\n{parts}\n\nEtwa {size}. Ihr Windows-Benutzername wird in Pfaden unkenntlich gemacht; Ihr Nexus-API-Schlüssel und Ihre Spielstände werden nie gesendet.',
    reportViewHint: 'Mit „Inhalt ansehen“ können Sie den ganzen Bericht vorher lesen.',
    reportSent: 'Bericht gesendet',
    reportSentDetail: 'Berichtsnummer: {id}\nGeben Sie diese Nummer an, wenn Sie auf Nexus schreiben, damit der Autor Ihren Bericht findet.',
    reportNotSent: 'Der Bericht wurde nicht gesendet',
    reportSavedHint: 'Der Bericht wurde als Datei gespeichert:\n{path}\nSie können diese Datei an einen Beitrag auf Nexus anhängen.',
    reportSections: {
      context: 'Fehler',
      app: 'HZMM und Windows',
      hw: 'Hardware',
      disk: 'Temp-Ordner und Speicherort von HZMM',
      av: 'Virenschutz',
      game: 'Spiel und UE4SS',
      mods: 'Installierte Mods',
      log: 'HZMM-Log (letzte 1000 Zeilen)'
    },
    reportNoteTitle: 'Was ist passiert',
    reportNexusName: 'Nexus-Name'
  },
  fr: {
    trayShow: 'Afficher HZMM',
    trayQuit: 'Quitter',
    modFiles: 'Fichiers de mod',
    allFiles: 'Tous les fichiers',
    ue4ssZipTitle: "Choisir le zip d'UE4SS",
    ue4ssZipFilter: 'Archive UE4SS (*.zip)',
    startupFailed: "HZMM n'a pas pu démarrer. L'erreur est indiquée ci-dessous ; le fichier journal contient plus de détails :",
    reportSendButton: 'Envoyer un rapport',
    closeButton: 'Fermer',
    reportViewButton: 'Voir le contenu',
    reportCancelButton: 'Annuler',
    reportConfirm: "Envoyer ce rapport de problème à l'auteur de HZMM ?",
    reportConfirmDetail: "Il contient :\n{parts}\n\nEnviron {size}. Votre nom d'utilisateur Windows est masqué dans les chemins ; votre clé API Nexus et vos sauvegardes ne sont jamais envoyées.",
    reportViewHint: "« Voir le contenu » permet de lire tout le rapport avant l'envoi.",
    reportSent: 'Rapport envoyé',
    reportSentDetail: "Numéro du rapport : {id}\nIndiquez ce numéro dans votre message sur Nexus pour que l'auteur retrouve votre rapport.",
    reportNotSent: "Le rapport n'a pas été envoyé",
    reportSavedHint: 'Le rapport a été enregistré dans un fichier :\n{path}\nVous pouvez joindre ce fichier à un message sur Nexus.',
    reportSections: {
      context: 'Erreur',
      app: 'HZMM et Windows',
      hw: 'Matériel',
      disk: 'Dossier temporaire et emplacement de HZMM',
      av: 'Antivirus',
      game: 'Jeu et UE4SS',
      mods: 'Mods installés',
      log: 'Journal de HZMM (1000 dernières lignes)'
    },
    reportNoteTitle: "Ce qui s'est passé",
    reportNexusName: 'Nom sur Nexus'
  }
}

export function mainText(locale: string): MainText {
  return TEXT[locale] ?? TEXT.en
}
