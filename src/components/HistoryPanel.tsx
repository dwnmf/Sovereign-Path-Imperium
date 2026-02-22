import type { ActionRecord } from '../types'

interface HistoryPanelProps {
  open: boolean
  items: ActionRecord[]
  loading: boolean
  error: string
  offset: number
  pageSize: number
  onClose: () => void
  onUndo: () => void
  onPage: (offset: number) => void
}

function formatTime(value: string): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('sv-SE').replace('T', ' ')
}

export function HistoryPanel({
  open,
  items,
  loading,
  error,
  offset,
  pageSize,
  onClose,
  onUndo,
  onPage,
}: HistoryPanelProps) {
  return (
    <aside className={`historyPanel ${open ? 'historyPanel--open' : ''}`}>
      <div className="historyHeader">
        <h3>History</h3>
        <button className="button" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <button
        className="button"
        disabled={items[0]?.action_type === 'Undo'}
        title={items[0]?.action_type === 'Undo' ? 'Nothing to undo' : ''}
        onClick={onUndo}
        type="button"
      >
        Undo last action
      </button>

      {error ? <div className="inlineError">{error}</div> : null}
      {loading ? <div className="emptyState">Loading history...</div> : null}

      <div className="historyList">
        {items.map((item) => (
          <div className="historyItem" key={item.id}>
            <span>{formatTime(item.timestamp)}</span>
            <span>{item.action_type}</span>
            <span>{item.link_path}</span>
            <span>{item.target_new ?? item.target_old ?? ''}</span>
          </div>
        ))}
      </div>

      <div className="historyPager">
        <button
          className="button"
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - pageSize))}
          type="button"
        >
          Prev
        </button>
        <button
          className="button"
          disabled={items.length < pageSize}
          onClick={() => onPage(offset + pageSize)}
          type="button"
        >
          Next
        </button>
      </div>
    </aside>
  )
}
