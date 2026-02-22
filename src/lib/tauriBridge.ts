import { makeDefaultConfig, makeMockDetails, makeMockEntries, makeMockHistory, makeMockVolumes } from './mock'
import type {
  ActionRecord,
  Config,
  ExportFormat,
  LinkDetails,
  LinkEntry,
  LinkStatus,
  LinkType,
  ScanProgress,
  VolumeInfo,
} from '../types'

interface CreateArgs {
  linkPath: string
  targetPath: string
  linkType: LinkType
  targetIsDir?: boolean
}

const runtimeWindow = window as Window & {
  __TAURI_INTERNALS__?: unknown
}

interface RawLinkEntry {
  path: string
  target: string
  link_type: LinkType
  status: unknown
}

interface RawLinkDetails extends Omit<LinkDetails, 'status'> {
  status: unknown
}

function isTauriRuntime(): boolean {
  return Boolean(runtimeWindow.__TAURI_INTERNALS__)
}

async function invokeTauri<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('symview is running in web fallback mode (no Tauri runtime).')
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, payload)
}

export async function listenScanProgress(
  callback: (progress: ScanProgress) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<ScanProgress>('scan:progress', (event) => callback(event.payload))

  return unlisten
}

export async function apiListVolumes(): Promise<VolumeInfo[]> {
  if (!isTauriRuntime()) {
    return makeMockVolumes()
  }

  return invokeTauri<VolumeInfo[]>('list_volumes')
}

export async function apiIsElevated(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false
  }

  return invokeTauri<boolean>('is_elevated')
}

export async function apiRelaunchAsAdmin(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Relaunch as administrator is available only in Tauri runtime.')
  }

  await invokeTauri<void>('relaunch_as_admin')
}

export async function apiScanVolume(drive: string): Promise<LinkEntry[]> {
  if (!isTauriRuntime()) {
    return makeMockEntries()
  }

  const payload = await invokeTauri<RawLinkEntry[]>('scan_volume', { drive })
  return payload.map((entry) => ({
    ...entry,
    status: normalizeStatus(entry.status),
  }))
}

export async function apiValidateLinks(entries: LinkEntry[]): Promise<LinkEntry[]> {
  if (!isTauriRuntime()) {
    return entries
  }

  const payload = await invokeTauri<RawLinkEntry[]>('validate_links', { entries })
  return payload.map((entry) => ({
    ...entry,
    status: normalizeStatus(entry.status),
  }))
}

export async function apiGetLinkDetails(path: string): Promise<LinkDetails> {
  if (!isTauriRuntime()) {
    return makeMockDetails(path)
  }

  const payload = await invokeTauri<RawLinkDetails>('get_link_details', { path })
  return {
    ...payload,
    status: normalizeStatus(payload.status),
  }
}

export async function apiCreateLink(args: CreateArgs): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('create_link', {
    linkPath: args.linkPath,
    targetPath: args.targetPath,
    linkType: args.linkType,
    targetIsDir: args.targetIsDir ?? false,
  })
}

export async function apiDeleteLink(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('delete_link', { path })
}

export async function apiRetargetLink(path: string, newTarget: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('retarget_link', { path, newTarget })
}

export async function apiExportLinks(
  entries: LinkEntry[],
  format: ExportFormat,
  outputPath: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('export_links', { entries, format, path: outputPath })
}

export async function apiOpenTarget(target: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('open_target', { target })
}

export async function apiGetHistory(limit: number, offset: number): Promise<ActionRecord[]> {
  if (!isTauriRuntime()) {
    return makeMockHistory(limit)
  }

  return invokeTauri<ActionRecord[]>('get_history', { limit, offset })
}

export async function apiUndoLast(): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('undo_last')
}

export async function apiLoadConfig(): Promise<Config> {
  if (!isTauriRuntime()) {
    return makeDefaultConfig()
  }

  return invokeTauri<Config>('load_config_command')
}

export async function apiSaveConfig(config: Config): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('save_config_command', { config })
}

export async function apiIsShellRegistered(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false
  }

  return invokeTauri<boolean>('is_shell_integration_registered')
}

export async function apiRegisterShell(): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('register_shell_integration')
}

export async function apiUnregisterShell(): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeTauri<void>('unregister_shell_integration')
}

function normalizeStatus(raw: unknown): LinkStatus {
  if (raw === 'Ok' || raw === 'Broken' || raw === 'AccessDenied') {
    return raw
  }

  if (typeof raw === 'object' && raw !== null) {
    const keyed = raw as Record<string, unknown>

    if (typeof keyed.kind === 'string') {
      if (keyed.kind === 'Broken') {
        return 'Broken'
      }

      if (keyed.kind === 'AccessDenied') {
        return 'AccessDenied'
      }

      return 'Ok'
    }

    if ('Broken' in keyed) {
      return 'Broken'
    }
  }

  return 'Ok'
}
