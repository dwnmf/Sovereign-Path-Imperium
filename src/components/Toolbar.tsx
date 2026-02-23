import type { ExportFormat, StatusFilter, TypeFilter, VolumeInfo } from '../types'

interface ToolbarProps {
  volumes: VolumeInfo[]
  selectedVolume: string
  search: string
  typeFilter: TypeFilter
  statusFilter: StatusFilter
  isScanning: boolean
  scanSummary: string
  scanEngineLabel: string
  scanEngineFast: boolean
  onVolumeChange: (value: string) => void
  onSearchChange: (value: string) => void
  onTypeFilterChange: (value: TypeFilter) => void
  onStatusFilterChange: (value: StatusFilter) => void
  onOpenCreate: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  onExport: (format: ExportFormat) => void
}

function bytesToGb(bytes: number): string {
  return `${Math.floor(bytes / 1_000_000_000)} GB`
}

export function Toolbar({
  volumes,
  selectedVolume,
  search,
  typeFilter,
  statusFilter,
  isScanning,
  scanSummary,
  scanEngineLabel,
  scanEngineFast,
  onVolumeChange,
  onSearchChange,
  onTypeFilterChange,
  onStatusFilterChange,
  onOpenCreate,
  onOpenHistory,
  onOpenSettings,
  onExport,
}: ToolbarProps) {
  const canChangeVolume = volumes.length > 0 && !isScanning

  return (
    <div className="toolbar">
      <div className="toolbarLeft">
        <label className="controlBlock controlBlock--volume">
          <span className="controlLabel">Volume</span>
          <select
            value={selectedVolume}
            onChange={(event) => onVolumeChange(event.target.value)}
            disabled={!canChangeVolume}
          >
            {volumes.map((volume) => (
              <option key={volume.letter} value={volume.letter}>
                {volume.letter} ({volume.label}, {bytesToGb(volume.free_bytes)} free)
              </option>
            ))}
          </select>
        </label>

        <label className="controlBlock controlBlock--search">
          <span className="controlLabel">Path query</span>
          <input
            placeholder="Search path or target"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <label className="controlBlock">
          <span className="controlLabel">Type</span>
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}>
            <option value="All">All</option>
            <option value="Symlink">Symlink</option>
            <option value="Junction">Junction</option>
            <option value="Hardlink">Hardlink</option>
          </select>
        </label>

        <label className="controlBlock">
          <span className="controlLabel">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
          >
            <option value="All">All</option>
            <option value="Working">Working</option>
            <option value="Broken">Broken</option>
            <option value="AccessDenied">Access Denied</option>
          </select>
        </label>
      </div>

      <div className="toolbarRight">
        <div className={`scanEngineBadge ${scanEngineFast ? 'scanEngineBadge--fast' : 'scanEngineBadge--compat'}`}>
          <span>{scanEngineLabel}</span>
        </div>

        <button className="button button--primary button--icon" onClick={onOpenCreate} type="button">
          New Link
        </button>

        <div className="menuButton">
          <button className="button button--icon" type="button">
            Export
          </button>
          <div className="menuContent">
            <button type="button" onClick={() => onExport('Csv')}>
              CSV
            </button>
            <button type="button" onClick={() => onExport('Json')}>
              JSON
            </button>
          </div>
        </div>

        <button className="button button--icon" onClick={onOpenHistory} type="button">
          History
        </button>

        <button className="button button--icon" onClick={onOpenSettings} type="button">
          Settings
        </button>

        <div className="scanStatus">
          <span>{scanSummary}</span>
        </div>
      </div>
    </div>
  )
}
