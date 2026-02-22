import { List } from 'react-window'
import type { RowComponentProps } from 'react-window'
import type { LinkEntry } from '../types'

const ROW_HEIGHT = 34
const FixedSizeList = List

interface LinkListProps {
  entries: LinkEntry[]
  activePath: string | null
  width: number
  height: number
  onSelect: (path: string) => void
}

interface RowProps {
  entries: LinkEntry[]
  activePath: string | null
  onSelect: (path: string) => void
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
  index,
  entries,
  activePath,
  onSelect,
  style,
}: RowComponentProps<RowProps>) {
  const entry = entries[index]
  const active = activePath === entry.path
  const pathParts = splitPath(entry.path)

  const badge =
    entry.status === 'AccessDenied'
      ? '🔒'
      : entry.link_type === 'Junction'
        ? 'JNC'
        : entry.status === 'Broken'
          ? '!!!'
          : 'OK'

  return (
    <div style={style} className="linkListRowWrap">
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
          {badge}
        </span>
      </button>
    </div>
  )
}

export function LinkList({ entries, activePath, width, height, onSelect }: LinkListProps) {
  if (entries.length === 0) {
    return <div className="emptyState">No links found for current filters.</div>
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
