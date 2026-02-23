import { makeDefaultConfig, makeMockDetails, makeMockEntries, makeMockHistory, makeMockVolumes } from './mock'
import type {
  ActionRecord,
  Config,
  ExportFormat,
  LinkDetails,
  LinkEntry,
  ScanMode,
  ScanResult,
  LinkStatus,
  LinkType,
  ScanBatch,
  ScanProgress,
  VolumeInfo,
} from '../types'

interface CreateArgs {
  linkPath: string
  targetPath: string
  linkType: LinkType
  targetIsDir?: boolean
}

interface InvokeOptions {
  signal?: AbortSignal
}

interface ListenOptions {
  signal?: AbortSignal
}

type RuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown
  __TAURI__?: unknown
}

interface RawLinkEntry {
  path?: unknown
  target?: unknown
  link_type?: unknown
  linkType?: unknown
  status?: unknown
}

interface RawLinkDetails extends Omit<LinkDetails, 'status'> {
  status: unknown
}

interface RawScanResult {
  entries: RawLinkEntry[]
  mode: unknown
}

interface RawScanBatch {
  entries: RawLinkEntry[]
}

interface TauriLinkEntryPayload {
  path: string
  target: string
  linkType: LinkType
  status: 'Ok'
}

function getRuntimeWindow(): RuntimeWindow | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window as RuntimeWindow
}

function isTauriRuntime(): boolean {
  const runtimeWindow = getRuntimeWindow()
  return Boolean(runtimeWindow?.__TAURI_INTERNALS__ || runtimeWindow?.__TAURI__)
}

function makeAbortError(): Error {
  const abortError = new Error('Operation cancelled')
  abortError.name = 'AbortError'
  return abortError
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError'
  }

  if (typeof error === 'object' && error !== null) {
    const payload = error as { name?: unknown }
    return payload.name === 'AbortError'
  }

  return false
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise
  }

  if (signal.aborted) {
    return Promise.reject(makeAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(makeAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })

    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      })
      .catch((error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
  })
}

async function invokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('symview is running in web fallback mode (no Tauri runtime).')
  }

  if (options.signal?.aborted) {
    throw makeAbortError()
  }

  const { invoke } = await import('@tauri-apps/api/core')

  try {
    return await withAbortSignal(invoke<T>(command, payload), options.signal)
  } catch (error) {
    if (isAbortError(error)) {
      throw makeAbortError()
    }

    throw new Error(extractErrorMessage(error))
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (typeof error === 'object' && error !== null) {
    const payload = error as Record<string, unknown>

    for (const key of ['message', 'error', 'details', 'reason', 'cause']) {
      const value = payload[key]

      if (typeof value === 'string' && value.trim().length > 0) {
        return value
      }
    }

    try {
      return JSON.stringify(payload)
    } catch {
      return 'Unknown Tauri error'
    }
  }

  return 'Unknown Tauri error'
}

function isScanProgressPayload(payload: unknown): payload is ScanProgress {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const record = payload as Record<string, unknown>

  return (
    typeof record.scanned === 'number' &&
    typeof record.found === 'number' &&
    typeof record.current_path === 'string'
  )
}

function isScanBatchPayload(payload: unknown): payload is RawScanBatch {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const record = payload as Record<string, unknown>
  return Array.isArray(record.entries)
}

function normalizeLinkType(raw: unknown): LinkType {
  if (raw === 'Symlink' || raw === 'Junction' || raw === 'Hardlink') {
    return raw
  }

  return 'Symlink'
}

function normalizeLinkEntries(entries: RawLinkEntry[]): LinkEntry[] {
  const normalized: LinkEntry[] = []

  for (const entry of entries) {
    const path = typeof entry.path === 'string' ? entry.path : ''
    const target = typeof entry.target === 'string' ? entry.target : ''

    if (!path || !target) {
      continue
    }

    normalized.push({
      path,
      target,
      link_type: normalizeLinkType(entry.link_type ?? entry.linkType),
      status: normalizeStatus(entry.status),
    })
  }

  return normalized
}

function toTauriLinkEntries(entries: LinkEntry[]): TauriLinkEntryPayload[] {
  return entries.map((entry) => ({
    path: entry.path,
    target: entry.target,
    linkType: entry.link_type,
    // Rust-side validate/export do not consume incoming status; keep payload format stable.
    status: 'Ok',
  }))
}

export async function listenScanProgress(
  callback: (progress: ScanProgress) => void,
  options: ListenOptions = {},
): Promise<() => void> {
  if (!isTauriRuntime() || options.signal?.aborted) {
    return () => undefined
  }

  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<ScanProgress>('scan:progress', (event) => {
    if (isScanProgressPayload(event.payload)) {
      callback(event.payload)
    }
  })

  let disposed = false
  const cleanup = () => {
    if (disposed) {
      return
    }

    disposed = true
    options.signal?.removeEventListener('abort', cleanup)
    unlisten()
  }

  if (options.signal) {
    options.signal.addEventListener('abort', cleanup, { once: true })

    if (options.signal.aborted) {
      cleanup()
      return () => undefined
    }
  }

  return cleanup
}

export async function listenScanBatch(
  callback: (batch: ScanBatch) => void,
  options: ListenOptions = {},
): Promise<() => void> {
  if (!isTauriRuntime() || options.signal?.aborted) {
    return () => undefined
  }

  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<RawScanBatch>('scan:batch', (event) => {
    if (!isScanBatchPayload(event.payload)) {
      return
    }

    callback({
      entries: normalizeLinkEntries(event.payload.entries),
    })
  })

  let disposed = false
  const cleanup = () => {
    if (disposed) {
      return
    }

    disposed = true
    options.signal?.removeEventListener('abort', cleanup)
    unlisten()
  }

  if (options.signal) {
    options.signal.addEventListener('abort', cleanup, { once: true })

    if (options.signal.aborted) {
      cleanup()
      return () => undefined
    }
  }

  return cleanup
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

export async function apiScanVolume(drive: string, options: InvokeOptions = {}): Promise<ScanResult> {
  if (!isTauriRuntime()) {
    return {
      entries: makeMockEntries(),
      mode: 'WalkdirFallback',
    }
  }

  const payload = await invokeTauri<RawScanResult>('scan_volume', { drive }, options)

  if (!Array.isArray(payload.entries)) {
    throw new Error('scan_volume returned invalid entries payload')
  }

  return {
    entries: normalizeLinkEntries(payload.entries),
    mode: normalizeScanMode(payload.mode),
  }
}

export async function apiValidateLinks(
  entries: LinkEntry[],
  options: InvokeOptions = {},
): Promise<LinkEntry[]> {
  if (!isTauriRuntime()) {
    return entries
  }

  const payload = await invokeTauri<RawLinkEntry[]>(
    'validate_links',
    { entries: toTauriLinkEntries(entries) },
    options,
  )

  if (!Array.isArray(payload)) {
    throw new Error('validate_links returned invalid payload')
  }

  return normalizeLinkEntries(payload)
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

  await invokeTauri<void>('export_links', {
    entries: toTauriLinkEntries(entries),
    format,
    path: outputPath,
  })
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

function normalizeScanMode(raw: unknown): ScanMode {
  return raw === 'UsnJournal' ? 'UsnJournal' : 'WalkdirFallback'
}
