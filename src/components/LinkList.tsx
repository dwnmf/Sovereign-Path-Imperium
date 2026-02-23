import { List } from 'react-window'
import type { RowComponentProps } from 'react-window'
import type { LinkEntry } from '../types'

const ROW_HEIGHT = 42
const FixedSizeList = List

interface LinkListProps {
  entries: LinkEntry[]
  activePath: string | null
  width: number
  height: number
  isScanning: boolean
  onSelect: (path: string) => void
}

interface RowProps {
  entries: LinkEntry[]
  activePath: string | null
  onSelect: (path: string) => void
}

function statusBadgeText(entry: LinkEntry): string {
  if (entry.status === 'AccessDenied') {
    return 'Denied'
  }

  if (entry.status === 'Broken') {
    return 'Broken'
  }

  if (entry.link_type === 'Junction') {
    return 'Junction'
  }

  return 'Ready'
}

function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replaceAll('/', '\\')
  const idx = normalized.lastIndexOf('\\')

  if (idx < 0) {
    return {
      dir: '',
      name: normalized,
    }
  }

  return {
    dir: normalized.slice(0, idx + 1),
    name: normalized.slice(idx + 1),
  }
}

function Row({
  ariaAttributes,
  index,
  entries,
  activePath,
  onSelect,
  style,
}: RowComponentProps<RowProps>) {
  const entry = entries[index]

  // During fast filter/scan updates, virtualized rows can briefly request a stale index.
  if (!entry) {
    return null
  }

  const active = activePath === entry.path
  const pathParts = splitPath(entry.path)

  return (
    <div {...ariaAttributes} style={style} className="linkListRowWrap">
      <button
        type="button"
        className={`linkListRow ${active ? 'linkListRow--active' : ''}`}
        onClick={() => onSelect(entry.path)}
      >
        <span className="linkPath" title={entry.path}>
          <span className="pathDim">{pathParts.dir}</span>
          <span className="pathAccent">{pathParts.name}</span>
        </span>

        <span
          className={`targetText ${entry.status === 'Broken' ? 'targetText--broken' : ''}`}
          title={entry.target}
        >
          {entry.target}
        </span>

        <span
          className={`statusBadge statusBadge--${entry.status.toLowerCase()}`}
          aria-label={entry.status}
        >
          {statusBadgeText(entry)}
        </span>
      </button>
    </div>
  )
}

export function LinkList({ entries, activePath, width, height, isScanning, onSelect }: LinkListProps) {
  if (entries.length === 0 && isScanning) {
    return (
      <div className="listSkeleton" role="status" aria-live="polite">
        {Array.from({ length: 9 }, (_, index) => (
          <div className="listSkeletonRow" key={`skeleton-${index}`}>
            <span className="listSkeletonBlock listSkeletonBlock--path" />
            <span className="listSkeletonBlock listSkeletonBlock--target" />
            <span className="listSkeletonPill" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="emptyState">
        <p className="emptyStateTitle">No links match these filters</p>
        <p className="emptyStateHint">Reset search or switch status/type to repopulate this view.</p>
      </div>
    )
  }

  return (
    <FixedSizeList<RowProps>
      rowComponent={Row}
      rowCount={entries.length}
      rowHeight={ROW_HEIGHT}
      rowProps={{ entries, activePath, onSelect }}
      style={{ width, height }}
    />
  )
}
