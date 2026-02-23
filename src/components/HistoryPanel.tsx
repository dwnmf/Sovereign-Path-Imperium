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
  const latestSuccessfulItem = offset === 0 ? items.find((item) => item.success) : undefined
  const canUndo = !loading && latestSuccessfulItem !== undefined && latestSuccessfulItem.action_type !== 'Undo'
  const undoTitle = loading
    ? 'History is loading'
    : offset > 0
      ? 'Go to the first page to undo the latest action'
      : !canUndo
        ? 'Nothing to undo'
        : ''
  const canPagePrev = !loading && offset > 0
  const canPageNext = !loading && items.length >= pageSize

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
        disabled={!canUndo}
        title={undoTitle}
        onClick={onUndo}
        type="button"
      >
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

      <div className="historyList" aria-busy={loading}>
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
          disabled={!canPagePrev}
          onClick={() => {
            if (!canPagePrev) {
              return
            }

            onPage(Math.max(0, offset - pageSize))
          }}
          type="button"
        >
          Prev
        </button>
        <button
          className="button"
          disabled={!canPageNext}
          onClick={() => {
            if (!canPageNext) {
              return
            }

            onPage(offset + pageSize)
          }}
          type="button"
        >
          Next
        </button>
      </div>
    </aside>
  )
}
