import { ArrowLeft, ArrowRight, ArrowsCounterClockwise, ClockCounterClockwise } from '@phosphor-icons/react'
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
        <h3>
          <ClockCounterClockwise size={16} weight="duotone" />
          History
        </h3>
        <button className="button" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <button
        className="button button--icon"
        disabled={items[0]?.action_type === 'Undo'}
        title={items[0]?.action_type === 'Undo' ? 'Nothing to undo' : ''}
        onClick={onUndo}
        type="button"
      >
        <ArrowsCounterClockwise size={16} weight="duotone" />
        Undo last action
      </button>

      {error ? <div className="inlineError">{error}</div> : null}
      {loading ? <div className="emptyState">Loading history...</div> : null}
      {!loading && items.length === 0 ? (
        <div className="emptyState">
          <p className="emptyStateTitle">No history yet</p>
          <p className="emptyStateHint">Created, retargeted and deleted links will appear here.</p>
        </div>
      ) : null}

      <div className="historyList">
        {items.map((item) => (
          <div className="historyItem" key={item.id}>
            <div className="historyItemTop">
              <span>{formatTime(item.timestamp)}</span>
              <span className={`historyOutcome ${item.success ? 'historyOutcome--ok' : 'historyOutcome--failed'}`}>
                {item.success ? 'Applied' : 'Failed'}
              </span>
            </div>
            <span className="historyAction">{item.action_type}</span>
            <span className="historyPath">{item.link_path}</span>
            <span className="historyTarget">{item.target_new ?? item.target_old ?? ''}</span>
            {item.error_msg ? <span className="historyErrorText">{item.error_msg}</span> : null}
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
          <ArrowLeft size={14} weight="bold" />
          Prev
        </button>
        <button
          className="button button--icon"
          disabled={items.length < pageSize}
          onClick={() => onPage(offset + pageSize)}
          type="button"
        >
          <ArrowRight size={14} weight="bold" />
          Next
        </button>
      </div>
    </aside>
  )
}
