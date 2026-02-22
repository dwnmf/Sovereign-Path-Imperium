import type { ExportFormat, StatusFilter, TypeFilter, VolumeInfo } from '../types'

interface ToolbarProps {
  volumes: VolumeInfo[]
  selectedVolume: string
  search: string
  typeFilter: TypeFilter
  statusFilter: StatusFilter
  isScanning: boolean
  scanSummary: string
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
  onVolumeChange,
  onSearchChange,
  onTypeFilterChange,
  onStatusFilterChange,
  onOpenCreate,
  onOpenHistory,
  onOpenSettings,
  onExport,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbarLeft">
        <select value={selectedVolume} onChange={(event) => onVolumeChange(event.target.value)}>
          {volumes.map((volume) => (
            <option key={volume.letter} value={volume.letter}>
              {volume.letter} ({volume.label}, {bytesToGb(volume.free_bytes)} free)
            </option>
          ))}
        </select>

        <input
          placeholder="Search paths"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />

        <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}>
          <option value="All">All</option>
          <option value="Symlink">Symlink</option>
          <option value="Junction">Junction</option>
          <option value="Hardlink">Hardlink</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
        >
          <option value="All">All</option>
          <option value="Working">Working</option>
          <option value="Broken">Broken</option>
          <option value="AccessDenied">Access Denied</option>
        </select>
      </div>

      <div className="toolbarRight">
        <button className="button button--primary" onClick={onOpenCreate} type="button">
          + New Link
        </button>

        <div className="menuButton">
          <button className="button" type="button">
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

        <button className="button" onClick={onOpenHistory} type="button">
          History
        </button>

        <button className="button" onClick={onOpenSettings} type="button">
          Settings
        </button>

        <div className="scanStatus">
          {isScanning ? <span className="spinner" /> : null}
          <span>{scanSummary}</span>
        </div>
      </div>
    </div>
  )
}
