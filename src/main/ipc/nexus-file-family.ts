// Which Nexus files are versions of the SAME file — shared by the update
// checker (is there a newer version of what's installed?) and the update flow
// (which install receipt does an incoming file replace?). Both must agree, or
// the checker would offer an update the flow then installs as a separate mod.
//
// Nexus records the relationship itself: a version uploaded as an update of an
// existing file keeps that file's `groupId` (HZMM's own Nexus upload workflow
// targets its group, 7246205). Authors are free to rename every upload, and
// many embed the version in the name ("... 1.1X v1.2.1" -> "... 1.1Z v1.3.0"),
// so matching on the name alone never sees those updates. Same-name is kept as
// a second signal for authors who upload each version as a brand-new file
// (new group) under an unchanged name. On a multi-variant page every variant is
// its own group with its own name, so neither signal crosses variants.

import type { NexusModFile } from './types'

type FamilyFields = Pick<NexusModFile, 'name' | 'group_id'>

export function isSameFileFamily(a: FamilyFields | null | undefined, b: FamilyFields | null | undefined): boolean {
  if (!a || !b) return false
  if (a.group_id != null && a.group_id === b.group_id) return true
  return a.name === b.name
}

// Archived / deleted uploads (V2 categoryId 7 / 6) are withdrawn from the files
// tab — never offer one as the version to update to.
export function isRetiredFile(f: Pick<NexusModFile, 'category_id' | 'category_name'> | null | undefined): boolean {
  if (!f) return false
  return f.category_id === 6 || f.category_id === 7 || /archiv|delet/i.test(f.category_name || '')
}
