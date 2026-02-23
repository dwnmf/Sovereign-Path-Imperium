export type LinkType = 'Symlink' | 'Junction' | 'Hardlink'
export type LinkStatus = 'Ok' | 'Broken' | 'AccessDenied'
export type ObjectType = 'File' | 'Directory'
export type ScanMode = 'UsnJournal' | 'WalkdirFallback'
export type TypeFilter = 'All' | LinkType
export type StatusFilter = 'All' | 'Working' | 'Broken' | 'AccessDenied'
export type ExportFormat = 'Csv' | 'Json'
export type ActionType = 'Create' | 'Delete' | 'Retarget' | 'Undo'

export interface LinkEntry {
  path: string
  target: string
  link_type: LinkType
  status: LinkStatus
}

export interface LinkDetails {
  path: string
  target_real: string
  target_stored: string
  link_type: LinkType
  object_type: ObjectType
  created_at: string
  modified_at: string
  owner: string
  attributes: string[]
  status: LinkStatus
}

export interface ScanProgress {
  scanned: number
  found: number
  current_path: string
}

export interface ScanBatch {
  entries: LinkEntry[]
}

export interface ScanResult {
  entries: LinkEntry[]
  mode: ScanMode
}

export interface VolumeInfo {
  letter: string
  label: string
  fs: string
  total_bytes: number
  free_bytes: number
}

export interface Config {
  scan: {
    default_volume: string
    excluded_paths: string[]
    auto_scan_on_start: boolean
  }
  ui: {
    remember_filters: boolean
    last_filter_type: TypeFilter
    last_filter_status: StatusFilter
  }
  shell: {
    context_menu_registered: boolean
  }
}

export interface ActionRecord {
  id: number
  action_type: ActionType
  link_path: string
  link_type: LinkType
  target_old: string | null
  target_new: string | null
  timestamp: string
  success: boolean
  error_msg: string | null
}
