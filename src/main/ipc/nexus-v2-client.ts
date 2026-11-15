// Nexus Mods V2 GraphQL client — unauthenticated, public-read only.
// Covers everything V2 exposes that we care about: mod list with sort +
// filter, keyword search (stemmed), mod detail, mod files. The V1 install
// endpoints (`download_link.json`, account validate) live elsewhere because
// they require an API key and have a different lifecycle.
//
// Game targeting: HumanitZ. gameId 5743 was probed via V2's
// `game(domainName: "humanitz")` and cached as a constant to skip a round
// trip per query.
//
// Split out of nexus.js as part of the 470-line refactor.

import { netRequest } from '../services/net-client'
import type { NexusModFile, V2ModDetail, V2ModsPage } from './types'

export const GAME_DOMAIN = 'humanitz'
export const GAME_ID = 5743

// Nexus serves at most 80 nodes per `mods` request, whatever `count` asks for
// (probed 2026-11-10: count 80 / 81 / 100 / 200 all returned 80 while
// totalCount reported the full 116). The list and search queries therefore
// page with `offset` until the catalogue is complete. MAX_PAGES only guards
// against a misbehaving API looping forever — HumanitZ has ~120 mods.
export const V2_PAGE_SIZE = 80
const MAX_PAGES = 25
const REQUEST_TIMEOUT_MS = 10000

// Concatenate raw response chunks THEN decode once. Decoding each chunk
// independently (the old `data += chunk` form) mangles any multi-byte UTF-8
// character that straddles a TCP chunk boundary into U+FFFD.
// (netRequest does this internally now; kept exported for its regression test.)
export function decodeUtf8Chunks(chunks: readonly Uint8Array[]): string {
  return Buffer.concat(chunks).toString('utf8')
}

// Shared fragment used everywhere we return a mod card.
const MOD_CARD_FIELDS = `
  modId
  name
  summary
  author
  version
  pictureUrl
  thumbnailUrl
  endorsements
  downloads
  adultContent
  updatedAt
  createdAt
  modCategory { name }
`

type SortDirection = 'ASC' | 'DESC'

// Map HZMM's UI sort option to a V2 ModsSort input.
// Valid sort keys (probed from schema): relevance, name, downloads,
// uniqueDownloads, endorsements, random, createdAt, updatedAt, size, lastComment.
export const SORT_MAP: Record<string, Record<string, { direction: SortDirection }>> = {
  trending: { endorsements: { direction: 'DESC' } },
  latest_updated: { updatedAt: { direction: 'DESC' } },
  latest_added: { createdAt: { direction: 'DESC' } },
  most_downloaded: { downloads: { direction: 'DESC' } },
  relevance: { relevance: { direction: 'DESC' } },
}

/** A V2 `modFiles` entry as GraphQL sends it (before normalization). */
interface V2ModFileRaw {
  fileId: number
  name: string
  version: string
  description: string | null
  categoryId: number
  category: string
  primary: boolean | number | null
  size: number
  /** GraphQL BigInt — arrives as a string. */
  sizeInBytes: string | number
  date: string
  uri: string
  totalDownloads: number
  uniqueDownloads: number
  groupId: number | null
}

interface GraphqlResponse<T> {
  data: T
  errors?: Array<{ message?: string }>
}

// netRequest rides Electron's net module (Chromium stack) so it follows the
// OS proxy settings — same reason downloadFile does. The hard deadline keeps
// the old "hung API never spins the UI forever" guarantee.
// `T` is the shape the query selects; the response is trusted to match it.
async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await netRequest('https://api.nexusmods.com/v2/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `HZMM/${process.env.npm_package_version || 'dev'}`,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'Nexus V2 GraphQL request timed out',
  })
  const data: string = res.bodyText
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`V2 HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
  }
  let parsed: GraphqlResponse<T>
  try {
    parsed = JSON.parse(data)
  } catch (e) {
    throw new Error(`V2 parse error: ${(e as Error).message}`)
  }
  if (parsed.errors) {
    throw new Error(`V2 GraphQL: ${parsed.errors[0]?.message || 'unknown'}`)
  }
  return parsed.data
}

const MODS_PAGE_QUERY = `query ModsPage($filter: ModsFilter, $sort: [ModsSort!], $count: Int, $offset: Int) {
  mods(filter: $filter, sort: $sort, count: $count, offset: $offset) {
    totalCount
    nodes { ${MOD_CARD_FIELDS} }
  }
}`

// Fetch every page of a `mods` query (see V2_PAGE_SIZE). Pages are requested
// one after another — offset is how many nodes have arrived so far — and nodes
// are de-duplicated by modId in case the ordering shifts between two requests
// (e.g. an endorsement landing mid-walk). Stops on an empty page, once
// totalCount is reached, or at MAX_PAGES.
async function fetchAllModPages(filter: Record<string, unknown>, sort: Record<string, { direction: SortDirection }>): Promise<V2ModsPage> {
  const nodes: V2ModsPage['nodes'] = []
  const seen = new Set<string>()
  let totalCount = 0
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gqlRequest<{ mods: V2ModsPage }>(MODS_PAGE_QUERY, {
      filter,
      sort: [sort],
      count: V2_PAGE_SIZE,
      offset,
    })
    const batch = Array.isArray(data?.mods?.nodes) ? data.mods.nodes : []
    totalCount = Number(data?.mods?.totalCount) || 0
    offset += batch.length
    for (const node of batch) {
      const key = String(node?.modId)
      if (seen.has(key)) continue
      seen.add(key)
      nodes.push(node)
    }
    if (batch.length === 0 || offset >= totalCount) break
  }
  return { totalCount, nodes }
}

export function v2ListMods({ sort }: { sort?: string } = {}): Promise<V2ModsPage> {
  const sortInput = (sort && SORT_MAP[sort]) || SORT_MAP.trending
  return fetchAllModPages({ gameDomainName: { value: GAME_DOMAIN } }, sortInput)
}

export function v2SearchMods({ keyword }: { keyword: string }): Promise<V2ModsPage> {
  // nameStemmed does fuzzy / stemmed substring match across the catalogue.
  // Relevance sort is the natural ordering for keyword results.
  return fetchAllModPages(
    {
      gameDomainName: { value: GAME_DOMAIN },
      nameStemmed: { value: keyword },
    },
    SORT_MAP.relevance,
  )
}

export async function v2GetMod(modId: number | string): Promise<V2ModDetail | null> {
  const data = await gqlRequest<{ mod: V2ModDetail | null }>(
    `query ModDetail($modId: ID!, $gameId: ID!) {
      mod(modId: $modId, gameId: $gameId) {
        modId
        name
        summary
        description
        author
        version
        pictureUrl
        thumbnailUrl
        thumbnailLargeUrl
        endorsements
        downloads
        fileSize
        adultContent
        updatedAt
        createdAt
        modCategory { name }
        uploader { name memberId }
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  return data.mod
}

export async function v2GetModFiles(modId: number | string): Promise<NexusModFile[]> {
  const data = await gqlRequest<{ modFiles: V2ModFileRaw[] | null }>(
    `query ModFiles($modId: ID!, $gameId: ID!) {
      modFiles(modId: $modId, gameId: $gameId) {
        fileId
        name
        version
        description
        categoryId
        category
        primary
        size
        sizeInBytes
        date
        uri
        totalDownloads
        uniqueDownloads
        groupId
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  // Normalize to the snake_case shape the renderer already expects.
  return (data.modFiles || []).map(f => ({
    file_id: f.fileId,
    name: f.name,
    version: f.version,
    description: f.description,
    category_id: f.categoryId,
    category_name: f.category,
    is_primary: !!f.primary,
    size: f.size,                          // KB, matches V1
    size_in_bytes: Number(f.sizeInBytes),  // GraphQL BigInt arrives as string
    uploaded_timestamp: f.date,
    file_name: f.uri,
    total_downloads: f.totalDownloads,
    unique_downloads: f.uniqueDownloads,
    // Same-file version chain — see nexus-file-family.ts.
    group_id: f.groupId == null ? null : Number(f.groupId),
  }))
}
