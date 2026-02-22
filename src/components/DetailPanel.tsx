import { useMemo, useState } from 'react'
import type { LinkDetails } from '../types'

interface DetailPanelProps {
  details: LinkDetails | null
  canUndo: boolean
  onOpenTarget: (target: string) => void
  onDelete: (path: string) => void
  onRetarget: (path: string, target: string) => Promise<void>
  onUndo: () => Promise<void>
}

function formatDate(value: string): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function statusChip(status: LinkDetails['status']) {
  if (status === 'AccessDenied') {
    return 'statusChip statusChip--warn'
  }

  if (status === 'Broken') {
    return 'statusChip statusChip--danger'
  }

  return 'statusChip statusChip--ok'
}

function diffSegments(a: string, b: string): { shared: string; tailA: string; tailB: string } {
  const max = Math.min(a.length, b.length)
  let idx = 0

  while (idx < max && a[idx] === b[idx]) {
    idx += 1
  }

  return {
    shared: a.slice(0, idx),
    tailA: a.slice(idx),
    tailB: b.slice(idx),
  }
}

export function DetailPanel({
  details,
  canUndo,
  onOpenTarget,
  onDelete,
  onRetarget,
  onUndo,
}: DetailPanelProps) {
  const [editMode, setEditMode] = useState(false)
  const [retargetValue, setRetargetValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const diff = useMemo(() => {
    if (!details) {
      return null
    }

    return diffSegments(details.target_stored, details.target_real)
  }, [details])

  if (!details) {
    return <div className="emptyState">Select a link to load details.</div>
  }

  const sameTarget = details.target_stored === details.target_real

  return (
    <div className="detailPanel">
      <div className="detailSection">
        <div className="detailRow">
          <span className="detailKey">Status</span>
          <span className={statusChip(details.status)}>{details.status}</span>
        </div>

        <div className="detailRow">
          <span className="detailKey">Path</span>
          <span className="detailValue">{details.path}</span>
        </div>

        <div className="detailRow">
          <span className="detailKey">Target stored</span>
          <span className="detailValue">{details.target_stored}</span>
        </div>

        {sameTarget ? (
          <div className="detailRow">
            <span className="detailKey">Target</span>
            <span className="detailValue">{details.target_real}</span>
          </div>
        ) : (
          <>
            <div className="detailRow">
              <span className="detailKey">Target real</span>
              <span className="detailValue">{details.target_real}</span>
            </div>

            <div className="diffBox" title="Difference between stored and resolved target">
              <span className="diffShared">{diff?.shared}</span>
              <span className="diffTail">{diff?.tailA || '(stored same)'}</span>
              <span> -&gt; </span>
              <span className="diffTail">{diff?.tailB || '(resolved same)'}</span>
            </div>
          </>
        )}
      </div>

      <div className="detailDivider" />

      <div className="detailSection">
        <div className="detailRow">
          <span className="detailKey">Type</span>
          <span className="detailValue">{details.link_type}</span>
        </div>
        <div className="detailRow">
          <span className="detailKey">Object</span>
          <span className="detailValue">{details.object_type}</span>
        </div>
        <div className="detailRow">
          <span className="detailKey">Created</span>
          <span className="detailValue">{formatDate(details.created_at)}</span>
        </div>
        <div className="detailRow">
          <span className="detailKey">Modified</span>
          <span className="detailValue">{formatDate(details.modified_at)}</span>
        </div>
        <div className="detailRow">
          <span className="detailKey">Owner</span>
          <span className="detailValue">{details.owner || '-'}</span>
        </div>
        <div className="detailRow detailRow--attributes">
          <span className="detailKey">Attributes</span>
          <span className="attributeList">
            {details.attributes.map((attribute) => (
              <span className="attributeTag" key={attribute}>
                {attribute}
              </span>
            ))}
          </span>
        </div>
      </div>

      {editMode ? (
        <div className="retargetInline">
          <input
            value={retargetValue}
            onChange={(event) => setRetargetValue(event.target.value)}
            placeholder="New target path"
          />
          <button
            className="button button--primary"
            disabled={busy || retargetValue.trim().length === 0}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onRetarget(details.path, retargetValue)
                setEditMode(false)
                setRetargetValue('')
              } catch (retargetError) {
                setError(retargetError instanceof Error ? retargetError.message : 'Retarget failed')
              } finally {
                setBusy(false)
              }
            }}
            type="button"
          >
            Confirm
          </button>
          <button
            className="button"
            onClick={() => {
              setEditMode(false)
              setRetargetValue('')
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? <div className="inlineError">{error}</div> : null}

      <div className="detailActions">
        <button className="button" onClick={() => onOpenTarget(details.target_real)} type="button">
          Open target
        </button>
        <button
          className="button"
          onClick={() => {
            setRetargetValue(details.target_stored)
            setEditMode(true)
          }}
          type="button"
        >
          Retarget
        </button>
        <button className="button button--danger" onClick={() => onDelete(details.path)} type="button">
          Delete
        </button>
        {canUndo ? (
          <button className="button" onClick={() => void onUndo()} type="button">
            Undo
          </button>
        ) : null}
      </div>
    </div>
  )
}
