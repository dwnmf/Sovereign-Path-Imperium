import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  apiIsElevated,
  apiListVolumes,
  apiLoadConfig,
  apiSaveConfig,
  apiScanVolume,
  apiValidateLinks,
  listenScanProgress,
} from '../lib/tauriBridge'
import type { Config, LinkEntry, ScanProgress, VolumeInfo } from '../types'

interface ScanState {
  entries: LinkEntry[]
  volumes: VolumeInfo[]
  currentVolume: string
  scanMethod: string
  scanProgress: ScanProgress | null
  isScanning: boolean
  isElevated: boolean
  config: Config | null
  error: string
}

const FALLBACK_SCAN_METHOD = 'walkdir fallback'

export function useScan() {
  const [state, setState] = useState<ScanState>({
    entries: [],
    volumes: [],
    currentVolume: 'C:',
    scanMethod: FALLBACK_SCAN_METHOD,
    scanProgress: null,
    isScanning: false,
    isElevated: false,
    config: null,
    error: '',
  })

  useEffect(() => {
    let unlisten: (() => void) | null = null

    listenScanProgress((progress) => {
      setState((previous) => ({
        ...previous,
        scanProgress: progress,
      }))
    })
      .then((listener) => {
        unlisten = listener
      })
      .catch(() => {
        unlisten = null
      })

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const runScan = useCallback(async (volume: string) => {
    setState((previous) => ({
      ...previous,
      currentVolume: volume,
      isScanning: true,
      error: '',
      scanProgress: null,
    }))

    try {
      const scanned = await apiScanVolume(volume)
      const validated = await apiValidateLinks(scanned)

      setState((previous) => ({
        ...previous,
        entries: validated,
        currentVolume: volume,
        scanMethod: previous.isElevated ? 'USN Journal / walkdir fallback' : FALLBACK_SCAN_METHOD,
      }))
    } catch (error) {
      setState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : 'Scan failed',
      }))
    } finally {
      setState((previous) => ({
        ...previous,
        isScanning: false,
      }))
    }
  }, [])

  const reloadConfig = useCallback(async () => {
    try {
      const [volumes, isElevated, config] = await Promise.all([
        apiListVolumes(),
        apiIsElevated(),
        apiLoadConfig(),
      ])

      const currentVolume = config.scan.default_volume || volumes[0]?.letter || 'C:'

      setState((previous) => ({
        ...previous,
        volumes,
        isElevated,
        config,
        currentVolume,
        scanMethod: isElevated ? 'USN Journal / walkdir fallback' : FALLBACK_SCAN_METHOD,
      }))

      if (config.scan.auto_scan_on_start) {
        await runScan(currentVolume)
      }
    } catch (error) {
      setState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : 'Unable to load startup state',
      }))
    }
  }, [runScan])

  useEffect(() => {
    void reloadConfig()
  }, [reloadConfig])

  const saveConfig = useCallback(async (config: Config) => {
    setState((previous) => ({ ...previous, config }))
    await apiSaveConfig(config)
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
