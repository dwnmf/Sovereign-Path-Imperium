import type {
  ActionRecord,
  ActionType,
  Config,
  LinkDetails,
  LinkEntry,
  LinkStatus,
  LinkType,
  VolumeInfo,
} from '../types'

const owners = ['BUILTIN\\Administrators', 'SYSTEM', 'k1NG'] as const
const actionTypes: readonly ActionType[] = ['Create', 'Delete', 'Retarget']
const linkTypes: readonly LinkType[] = ['Symlink', 'Junction', 'Hardlink']
const MAX_MOCK_ENTRIES = 200_000
const MAX_MOCK_HISTORY = 10_000

function normalizeCount(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)

  if (normalized <= 0) {
    return 0
  }

  return Math.min(normalized, max)
}

function hashText(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash
}

function pickStatus(index: number): LinkStatus {
  if (index % 17 === 0) {
    return 'AccessDenied'
  }

  if (index % 9 === 0) {
    return 'Broken'
  }

  return 'Ok'
}

function pickType(index: number): LinkType {
  if (index % 11 === 0) {
    return 'Hardlink'
  }

  if (index % 5 === 0) {
    return 'Junction'
  }

  return 'Symlink'
}

export function makeMockEntries(count = 50000): LinkEntry[] {
  const safeCount = normalizeCount(count, 50000, MAX_MOCK_ENTRIES)
  const items = new Array<LinkEntry>(safeCount)

  for (let index = 0; index < safeCount; index += 1) {
    const linkType = pickType(index)
    const status = pickStatus(index)
    const path = `C:\\symview\\links\\${linkType.toLowerCase()}-${index.toString().padStart(6, '0')}`
    const target = status === 'Broken' ? `C:\\missing\\target-${index}` : `C:\\data\\targets\\obj-${index}`

    items[index] = {
      path,
      target,
      link_type: linkType,
      status,
    }
  }

  return items
}

export function makeMockDetails(path: string): LinkDetails {
  const now = new Date().toISOString()

  return {
    path,
    target_stored: 'C:\\data\\targets\\obj',
    target_real: 'C:\\data\\targets\\obj',
    link_type: 'Symlink',
    object_type: 'Directory',
    created_at: now,
    modified_at: now,
    owner: owners[hashText(path) % owners.length],
    attributes: ['ARCHIVE', 'READONLY'],
    status: 'Ok',
  }
}

export function makeMockVolumes(): VolumeInfo[] {
  return [
    {
      letter: 'C:',
      label: 'System',
      fs: 'NTFS',
      total_bytes: 1_000_000_000_000,
      free_bytes: 234_000_000_000,
    },
    {
      letter: 'D:',
      label: 'Workspace',
      fs: 'NTFS',
      total_bytes: 512_000_000_000,
      free_bytes: 180_000_000_000,
    },
  ]
}

export function makeMockHistory(limit = 20): ActionRecord[] {
  const safeLimit = normalizeCount(limit, 20, MAX_MOCK_HISTORY)

  return Array.from({ length: safeLimit }, (_, index) => {
    const actionType = actionTypes[index % actionTypes.length]
    const previousTarget = `C:\\old\\target-${index}`
    const nextTarget = `C:\\new\\target-${index}`
    const success = index % 7 !== 0

    return {
      id: index + 1,
      action_type: actionType,
      link_path: `C:\\symview\\links\\mock-${index}`,
      link_type: linkTypes[index % linkTypes.length],
      target_old: actionType === 'Create' ? null : previousTarget,
      target_new: actionType === 'Delete' ? null : nextTarget,
      timestamp: new Date(Date.now() - index * 10_000_000).toISOString(),
      success,
      error_msg: success ? null : 'Mock failure: access denied',
    }
  })
}

export function makeDefaultConfig(): Config {
  return {
    scan: {
      default_volume: 'C:',
      excluded_paths: ['C:\\Windows\\WinSxS'],
      auto_scan_on_start: true,
    },
    ui: {
      remember_filters: true,
      last_filter_type: 'All',
      last_filter_status: 'All',
    },
    shell: {
      context_menu_registered: false,
    },
  }
}
