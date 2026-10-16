// Domain types shared across the main-process IPC modules.
//
// Shapes that cross module boundaries live here (Nexus V2 payloads, UE4SS
// registry files, Steam Workshop items, locales); a type only one module
// uses stays in that module. Field nullability follows what the code
// tolerates today — external payloads are typed as received, not as hoped.

// ---------------------------------------------------------------------------
// Nexus Mods V2 GraphQL (see nexus-v2-client)
// ---------------------------------------------------------------------------

/** A mod as returned by the list / search queries (MOD_CARD_FIELDS). */
export interface V2ModCard {
  modId: number
  name: string
  summary: string | null
  author: string | null
  version: string
  pictureUrl: string | null
  thumbnailUrl: string | null
  endorsements: number
  downloads: number
  adultContent: boolean
  updatedAt: string
  createdAt: string
  modCategory: { name: string } | null
}

/** One page of the `mods` query. */
export interface V2ModsPage {
  totalCount: number
  nodes: V2ModCard[]
}

/** The `mod` detail query. */
export interface V2ModDetail extends V2ModCard {
  description: string | null
  thumbnailLargeUrl: string | null
  fileSize: number | null
  uploader: { name: string; memberId: number } | null
}

/** A `modFiles` entry, normalized to the V1-style snake_case the renderer reads. */
export interface NexusModFile {
  file_id: number
  name: string
  version: string
  description: string | null
  category_id: number
  category_name: string
  is_primary: boolean
  /** KB, like V1. */
  size: number
  size_in_bytes: number
  /** ISO date string from V2's `date` (V1 used a unix timestamp). */
  uploaded_timestamp: string
  file_name: string
  total_downloads: number
  unique_downloads: number
}

// ---------------------------------------------------------------------------
// UE4SS registry (mods.json / mods.txt, see mods-registry)
// ---------------------------------------------------------------------------

/** One entry of UE4SS's Mods/mods.json. */
export interface Ue4ssModsJsonEntry {
  mod_name: string
  mod_enabled: boolean
}

// ---------------------------------------------------------------------------
// Steam Workshop (dev-only browser, see steam-workshop-*)
// ---------------------------------------------------------------------------

export interface WorkshopBrowseOptions {
  appId?: number
  /** 'trend' | 'toprated' | 'mostrecent'; anything else falls back to 'trend'. */
  sort?: string
  page?: number
  search?: string
}

/** A GetPublishedFileDetails entry, as Steam sends it. */
export interface SteamPublishedFileDetails {
  /** 1 = OK; anything else is deleted / hidden. */
  result: number
  publishedfileid: string | number
  title?: string
  preview_url?: string
  subscriptions?: number | string
  favorited?: number | string
  views?: number | string
  file_size?: number | string
  time_updated?: number | string
  time_created?: number | string
  tags?: Array<{ tag?: string }>
  description?: string
}

/** A workshop item in the renderer's display shape. */
export interface WorkshopItem {
  id: string
  title: string
  previewUrl: string
  subscriptions: number
  favorited: number
  views: number
  fileSize: number
  timeUpdated: number
  timeCreated: number
  tags: string[]
  descriptionBBCode: string
  url: string
}

export interface WorkshopBrowseResult {
  ok: boolean
  items: WorkshopItem[]
  page: number
  hasNext: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

export interface SupportedLocale {
  code: string
  /** The language's own name (endonym). */
  name: string
}
