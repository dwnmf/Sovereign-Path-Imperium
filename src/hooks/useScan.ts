import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  apiIsElevated,
  apiListVolumes,
  apiLoadConfig,
  apiSaveConfig,
  apiScanVolume,
  apiValidateLinks,
  isAbortError,
  listenScanBatch,
  listenScanProgress,
} from '../lib/tauriBridge'
import type { Config, LinkEntry, ScanMode, ScanProgress, VolumeInfo } from '../types'

interface ScanState {
  entries: LinkEntry[]
  volumes: VolumeInfo[]
  currentVolume: string
  scanMode: ScanMode
  scanMethod: string
  scanProgress: ScanProgress | null
  isScanning: boolean
  isElevated: boolean
  config: Config | null
  error: string
}

const INITIAL_SCAN_METHOD = 'No scan yet'
const SCAN_BATCH_FLUSH_MS = 200

function describeScanMode(mode: ScanMode): string {
  if (mode === 'UsnJournal') {
    return 'FAST · USN Journal (Everything-style)'
  }

  return 'COMPAT · walkdir fallback'
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

export function useScan() {
  const [state, setState] = useState<ScanState>({
    entries: [],
    volumes: [],
    currentVolume: 'C:',
    scanMode: 'WalkdirFallback',
    scanMethod: INITIAL_SCAN_METHOD,
    scanProgress: null,
    isScanning: false,
    isElevated: false,
    config: null,
    error: '',
  })

  const mountedRef = useRef(true)
  const activeScanRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const scanSequenceRef = useRef(0)
  const reloadSequenceRef = useRef(0)
  const pendingBatchEntriesRef = useRef<LinkEntry[]>([])
  const batchFlushTimerRef = useRef<number | null>(null)

  const clearBatchFlushTimer = useCallback(() => {
    if (batchFlushTimerRef.current !== null) {
      window.clearTimeout(batchFlushTimerRef.current)
      batchFlushTimerRef.current = null
    }
  }, [])

  const flushBatchEntries = useCallback(() => {
    if (!mountedRef.current || pendingBatchEntriesRef.current.length === 0) {
      return
    }

    const chunk = pendingBatchEntriesRef.current
    pendingBatchEntriesRef.current = []

    setState((previous) => {
      if (!previous.isScanning) {
        return previous
      }

      return {
        ...previous,
        entries: [...previous.entries, ...chunk],
      }
    })
  }, [])

  const scheduleBatchFlush = useCallback(() => {
    if (batchFlushTimerRef.current !== null) {
      return
    }

    batchFlushTimerRef.current = window.setTimeout(() => {
      batchFlushTimerRef.current = null
      flushBatchEntries()
    }, SCAN_BATCH_FLUSH_MS)
  }, [flushBatchEntries])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      activeScanRef.current?.controller.abort()
      activeScanRef.current = null
      clearBatchFlushTimer()
      pendingBatchEntriesRef.current = []
    }
  }, [clearBatchFlushTimer])

  useEffect(() => {
    const listenerController = new AbortController()

    void listenScanProgress(
      (progress) => {
        if (!mountedRef.current || !activeScanRef.current) {
          return
        }

        setState((previous) => {
          if (!previous.isScanning) {
            return previous
          }

          return {
            ...previous,
            scanProgress: progress,
          }
        })
      },
      { signal: listenerController.signal },
    ).catch((error) => {
      if (!mountedRef.current || isAbortError(error)) {
        return
      }

      setState((previous) => ({
        ...previous,
        error: getErrorMessage(error, 'Unable to subscribe to scan progress'),
      }))
    })

    return () => {
      listenerController.abort()
    }
  }, [])

  useEffect(() => {
    const listenerController = new AbortController()

    void listenScanBatch(
      (batch) => {
        if (!mountedRef.current || !activeScanRef.current || batch.entries.length === 0) {
          return
        }

        pendingBatchEntriesRef.current.push(...batch.entries)
        scheduleBatchFlush()
      },
      { signal: listenerController.signal },
    ).catch((error) => {
      if (!mountedRef.current || isAbortError(error)) {
        return
      }

      setState((previous) => ({
        ...previous,
        error: getErrorMessage(error, 'Unable to subscribe to scan batch stream'),
      }))
    })

    return () => {
      listenerController.abort()
    }
  }, [scheduleBatchFlush])

  const runScan = useCallback(async (volume: string) => {
    if (!mountedRef.current) {
      return
    }

    const previousScan = activeScanRef.current
    const controller = new AbortController()
    const scanId = scanSequenceRef.current + 1
    scanSequenceRef.current = scanId
    activeScanRef.current = { id: scanId, controller }
    previousScan?.controller.abort()
    clearBatchFlushTimer()
    pendingBatchEntriesRef.current = []

    setState((previous) => ({
      ...previous,
      entries: [],
      currentVolume: volume,
      isScanning: true,
      error: '',
      scanProgress: null,
    }))

    try {
      const scanned = await apiScanVolume(volume, { signal: controller.signal })
      const validated = await apiValidateLinks(scanned.entries, { signal: controller.signal })

      if (!mountedRef.current) {
        return
      }

      if (activeScanRef.current?.id !== scanId || controller.signal.aborted) {
        return
      }

      clearBatchFlushTimer()
      pendingBatchEntriesRef.current = []
      setState((previous) => ({
        ...previous,
        entries: validated,
        currentVolume: volume,
        scanMode: scanned.mode,
        scanMethod: describeScanMode(scanned.mode),
        error: '',
      }))
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      if (activeScanRef.current?.id !== scanId || isAbortError(error)) {
        return
      }

      clearBatchFlushTimer()
      pendingBatchEntriesRef.current = []
      setState((previous) => ({
        ...previous,
        error: getErrorMessage(error, 'Scan failed'),
      }))
    } finally {
      if (mountedRef.current && activeScanRef.current?.id === scanId) {
        clearBatchFlushTimer()
        flushBatchEntries()
        activeScanRef.current = null
        pendingBatchEntriesRef.current = []

        setState((previous) => ({
          ...previous,
          isScanning: false,
        }))
      }
    }
  }, [clearBatchFlushTimer, flushBatchEntries])

  const reloadConfig = useCallback(async () => {
    const reloadId = reloadSequenceRef.current + 1
    reloadSequenceRef.current = reloadId

    try {
      const [volumes, isElevated, config] = await Promise.all([
        apiListVolumes(),
        apiIsElevated(),
        apiLoadConfig(),
      ])

      if (!mountedRef.current || reloadSequenceRef.current !== reloadId) {
        return
      }

      const currentVolume = config.scan.default_volume || volumes[0]?.letter || 'C:'

      setState((previous) => ({
        ...previous,
        volumes,
        isElevated,
        config,
        currentVolume,
        error: '',
      }))

      if (config.scan.auto_scan_on_start) {
        await runScan(currentVolume)
      }
    } catch (error) {
      if (!mountedRef.current || reloadSequenceRef.current !== reloadId) {
        return
      }

      setState((previous) => ({
        ...previous,
        error: getErrorMessage(error, 'Unable to load startup state'),
      }))
    }
  }, [runScan])

  useEffect(() => {
    void reloadConfig()
  }, [reloadConfig])

  const saveConfig = useCallback(async (config: Config) => {
    try {
      await apiSaveConfig(config)

      if (!mountedRef.current) {
        return
      }

      setState((previous) => ({
        ...previous,
        config,
        error: '',
      }))
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      setState((previous) => ({
        ...previous,
        error: getErrorMessage(error, 'Unable to save configuration'),
      }))
    }
  }, [])

  const volumeLabel = useMemo(() => {
    return state.volumes.find((item) => item.letter === state.currentVolume)?.label ?? 'Volume'
  }, [state.currentVolume, state.volumes])

  return {
    ...state,
    volumeLabel,
    runScan,
    saveConfig,
    setState,
  }
}
