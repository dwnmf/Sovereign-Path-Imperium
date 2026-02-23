import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { CreateModal } from './components/CreateModal'
import { DetailPanel } from './components/DetailPanel'
import { ElevationBanner } from './components/ElevationBanner'
import { HistoryPanel } from './components/HistoryPanel'
import { LinkList } from './components/LinkList'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { useHistory } from './hooks/useHistory'
import { useLinks } from './hooks/useLinks'
import { useScan } from './hooks/useScan'
import {
  apiCreateLink,
  apiDeleteLink,
  apiExportLinks,
  apiGetLinkDetails,
  apiIsShellRegistered,
  apiOpenTarget,
  apiRegisterShell,
  apiRelaunchAsAdmin,
  apiRetargetLink,
  apiUnregisterShell,
} from './lib/tauriBridge'
import type { ExportFormat, LinkDetails, StatusFilter, TypeFilter } from './types'

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const node = ref.current

    if (!node) {
      return
    }

    const update = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => {
        window.removeEventListener('resize', update)
      }
    }

    const observer = new ResizeObserver(update)
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

  return { ref, size }
}

function resolveExportPath(format: ExportFormat): string | null {
  const extension = format === 'Csv' ? 'csv' : 'json'
  const promptValue = window.prompt('Export path', `C:\\symview\\exports\\links.${extension}`)
  return promptValue?.trim() || null
}

function App() {
  const scan = useScan()
  const history = useHistory()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')

  const [detailsResult, setDetailsResult] = useState<{
    path: string
    details: LinkDetails | null
    error: string
  } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [shellRegistered, setShellRegistered] = useState(false)

  const { ref: listRef, size: listSize } = useElementSize<HTMLDivElement>()

  const links = useLinks(scan.entries, {
    search,
    type: typeFilter,
    status: statusFilter,
  })

  useEffect(() => {
    apiIsShellRegistered()
      .then(setShellRegistered)
      .catch(() => setShellRegistered(false))
  }, [])

  const selectedPath = links.selectedEntry?.path

  useEffect(() => {
    if (!selectedPath) {
      return
    }

    let cancelled = false

    apiGetLinkDetails(selectedPath)
      .then((payload) => {
        if (!cancelled) {
          setDetailsResult({
            path: selectedPath,
            details: payload,
            error: '',
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailsResult({
            path: selectedPath,
            details: null,
            error: error instanceof Error ? error.message : 'Unable to load details',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedPath])

  const details = selectedPath && detailsResult?.path === selectedPath ? detailsResult.details : null
  const detailsError = selectedPath && detailsResult?.path === selectedPath ? detailsResult.error : ''
  const detailsLoading = Boolean(selectedPath) && (!detailsResult || detailsResult.path !== selectedPath)

  const scanSummary = useMemo(() => {
    if (scan.isScanning) {
      const volume = scan.currentVolume || 'C:'
      const progress = scan.scanProgress

      if (progress) {
        return `Scanning ${volume}... ${progress.found.toLocaleString()} links`
      }

      return `Scanning ${volume}...`
    }

    return `${scan.entries.length.toLocaleString()} links · ${scan.currentVolume} · ${scan.scanMethod}`
  }, [scan.currentVolume, scan.entries.length, scan.isScanning, scan.scanMethod, scan.scanProgress])

  const scanEngineLabel = useMemo(() => {
    if (scan.isScanning && scan.scanMethod === 'No scan yet') {
      return 'Verifying scan engine...'
    }

    if (scan.scanMode === 'UsnJournal') {
      return 'FAST · USN Journal (Everything-style)'
    }

    if (scan.scanMethod === 'No scan yet' && scan.isElevated) {
      return 'FAST available · run scan to verify'
    }

    if (scan.scanMethod === 'No scan yet' && !scan.isElevated) {
      return 'COMPAT · Admin needed for FAST'
    }

    if (scan.isElevated) {
      return 'COMPAT · USN failed, walkdir fallback'
    }

    return 'COMPAT · walkdir (no admin)'
  }, [scan.isElevated, scan.isScanning, scan.scanMethod, scan.scanMode])

  const fastScanActive = scan.scanMode === 'UsnJournal'
  const registryCount = links.filtered.length

  return (
    <div className="appRoot">
      <TitleBar isScanning={scan.isScanning} />

      <ElevationBanner
        visible={!scan.isElevated}
        onRestartAsAdmin={() => {
          void apiRelaunchAsAdmin()
        }}
      />

      <Toolbar
        volumes={scan.volumes}
        selectedVolume={scan.currentVolume}
        search={search}
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        isScanning={scan.isScanning}
        scanSummary={scanSummary}
        scanEngineLabel={scanEngineLabel}
        scanEngineFast={fastScanActive}
        onVolumeChange={(value) => {
          void scan.runScan(value)
        }}
        onSearchChange={setSearch}
        onTypeFilterChange={setTypeFilter}
        onStatusFilterChange={setStatusFilter}
        onOpenCreate={() => setShowCreate(true)}
        onOpenHistory={() => setShowHistory(true)}
        onOpenSettings={() => setShowSettings(true)}
        onExport={(format) => {
          const path = resolveExportPath(format)

          if (!path) {
            return
          }

          void apiExportLinks(scan.entries, format, path)
        }}
      />

      <main className="panelShell">
        <section className="leftPanel">
          <div className="panelHeader">
            <div>
              <div className="panelTitle">Link Registry</div>
              <div className="panelMeta">
                {scan.currentVolume} · {typeFilter} · {statusFilter}
              </div>
            </div>
            <div className="panelHeaderValue">{registryCount.toLocaleString()}</div>
          </div>
          <div className="listViewport" ref={listRef}>
            {listSize.height > 0 && listSize.width > 0 ? (
              <LinkList
                entries={links.filtered}
                activePath={links.selectedPath}
                onSelect={links.setSelectedPath}
                width={listSize.width}
                height={listSize.height}
                isScanning={scan.isScanning}
              />
            ) : null}
          </div>
        </section>

        <section className="rightPanel">
          <div className="panelHeader">
            <div>
              <div className="panelTitle">Inspector</div>
              <div className="panelMeta">
                {links.selectedEntry
                  ? `${links.selectedEntry.link_type} · ${links.selectedEntry.status}`
                  : 'Select a row to inspect path and metadata'}
              </div>
            </div>
            <div className="panelHeaderValue panelHeaderValue--subtle">
              {links.selectedEntry ? links.selectedEntry.path.split('\\').pop() : 'Idle'}
            </div>
          </div>
          {detailsError ? <div className="inlineError inlineError--margined">{detailsError}</div> : null}
          <DetailPanel
            details={details}
            loading={detailsLoading}
            canUndo={Boolean(history.items[0] && history.items[0].action_type !== 'Undo')}
            onOpenTarget={(target) => {
              void apiOpenTarget(target)
            }}
            onDelete={async (path) => {
              const confirmed = window.confirm(`Delete link?\n\n${path}`)

              if (!confirmed) {
                return
              }

              await apiDeleteLink(path)
              await scan.runScan(scan.currentVolume)
            }}
            onRetarget={async (path, target) => {
              await apiRetargetLink(path, target)
              await scan.runScan(scan.currentVolume)
            }}
            onUndo={async () => {
              await history.undoLast()
              await scan.runScan(scan.currentVolume)
            }}
          />
        </section>
      </main>

      <StatusBar
        symlinks={links.stats.symlinks}
        hardlinks={links.stats.hardlinks}
        working={links.stats.working}
        broken={links.stats.broken}
        junctions={links.stats.junctions}
        total={scan.entries.length}
        visible={links.filtered.length}
        scanning={scan.isScanning}
        volume={scan.currentVolume}
        method={scan.scanMethod}
        fastMode={fastScanActive}
      />

      <CreateModal
        open={showCreate}
        existingPaths={new Set(scan.entries.map((entry) => entry.path.toLowerCase()))}
        onClose={() => setShowCreate(false)}
        onSubmit={async ({ linkPath, targetPath, linkType, targetIsDir }) => {
          await apiCreateLink({ linkPath, targetPath, linkType, targetIsDir })
          void scan.runScan(scan.currentVolume)
        }}
      />

      <HistoryPanel
        open={showHistory}
        items={history.items}
        loading={history.isLoading}
        error={history.error}
        offset={history.offset}
        pageSize={history.pageSize}
        onClose={() => setShowHistory(false)}
        onUndo={() => {
          void (async () => {
            await history.undoLast()
            await scan.runScan(scan.currentVolume)
          })()
        }}
        onPage={(offset) => {
          void history.load(offset)
        }}
      />

      <SettingsModal
        open={showSettings}
        volumes={scan.volumes}
        config={scan.config}
        shellRegistered={shellRegistered}
        onClose={() => setShowSettings(false)}
        onConfigChange={async (next) => {
          await scan.saveConfig(next)
        }}
        onToggleShell={async (enabled) => {
          if (enabled) {
            await apiRegisterShell()
            setShellRegistered(true)
          } else {
            await apiUnregisterShell()
            setShellRegistered(false)
          }
        }}
      />

      {scan.error ? <div className="globalError">{scan.error}</div> : null}
    </div>
  )
}

export default App
