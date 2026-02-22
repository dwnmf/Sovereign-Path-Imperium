import type { ActionRecord, Config, LinkDetails, LinkEntry, LinkStatus, LinkType, VolumeInfo } from '../types'

const owners = ['BUILTIN\\Administrators', 'SYSTEM', 'k1NG']

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
  const items = new Array<LinkEntry>(count)

  for (let index = 0; index < count; index += 1) {
    const linkType = pickType(index)
    const path = `C:\\symview\\links\\${linkType.toLowerCase()}-${index.toString().padStart(6, '0')}`
    const target =
      pickStatus(index) === 'Broken'
        ? `C:\\missing\\target-${index}`
        : `C:\\data\\targets\\obj-${index}`

    items[index] = {
      path,
      target,
      link_type: linkType,
      status: pickStatus(index),
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
    owner: owners[Math.floor(Math.random() * owners.length)],
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
  return Array.from({ length: limit }, (_, index) => ({
    id: index + 1,
    action_type: ['Create', 'Delete', 'Retarget'][index % 3],
    link_path: `C:\\symview\\links\\mock-${index}`,
    link_type: ['Symlink', 'Junction', 'Hardlink'][index % 3] as LinkType,
    target_old: index % 2 === 0 ? `C:\\old\\target-${index}` : null,
    target_new: index % 2 === 0 ? `C:\\new\\target-${index}` : null,
    timestamp: new Date(Date.now() - index * 10_000_000).toISOString(),
    success: true,
    error_msg: null,
  }))
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
