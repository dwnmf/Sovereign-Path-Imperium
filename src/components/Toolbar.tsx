import {
  ClockCounterClockwise,
  DownloadSimple,
  FunnelSimple,
  GearSix,
  HardDrives,
  Lightning,
  MagnifyingGlass,
  Plus,
  Pulse,
} from '@phosphor-icons/react'
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

const ICON_SIZE = 16

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
          <span className="controlLabel">
            <HardDrives size={ICON_SIZE} weight="duotone" />
            Volume
          </span>
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
          <span className="controlLabel">
            <MagnifyingGlass size={ICON_SIZE} weight="duotone" />
            Path query
          </span>
          <input
            placeholder="Search path or target"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <label className="controlBlock">
          <span className="controlLabel">
            <FunnelSimple size={ICON_SIZE} weight="duotone" />
            Type
          </span>
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}>
            <option value="All">All</option>
            <option value="Symlink">Symlink</option>
            <option value="Junction">Junction</option>
            <option value="Hardlink">Hardlink</option>
          </select>
        </label>

        <label className="controlBlock">
          <span className="controlLabel">
            <FunnelSimple size={ICON_SIZE} weight="duotone" />
            Status
          </span>
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
          <Lightning size={ICON_SIZE} weight="duotone" />
          <span>{scanEngineLabel}</span>
        </div>

        <button className="button button--primary button--icon" onClick={onOpenCreate} type="button">
          <Plus size={ICON_SIZE} weight="bold" />
          New Link
        </button>

        <div className="menuButton">
          <button className="button button--icon" type="button">
            <DownloadSimple size={ICON_SIZE} weight="duotone" />
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
          <ClockCounterClockwise size={ICON_SIZE} weight="duotone" />
          History
        </button>

        <button className="button button--icon" onClick={onOpenSettings} type="button">
          <GearSix size={ICON_SIZE} weight="duotone" />
          Settings
        </button>

        <div className="scanStatus">
          {isScanning ? (
            <span className="spinner" />
          ) : (
            <span className="scanStatusIcon">
              <Pulse size={ICON_SIZE} weight="duotone" />
            </span>
          )}
          <span>{scanSummary}</span>
        </div>
      </div>
    </div>
  )
}
