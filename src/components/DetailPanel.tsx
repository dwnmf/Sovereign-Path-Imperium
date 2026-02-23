import { useEffect, useMemo, useState } from 'react'
import type { LinkDetails } from '../types'

interface DetailPanelProps {
  details: LinkDetails | null
  loading: boolean
  canUndo: boolean
  onOpenTarget: (target: string) => void | Promise<void>
  onDelete: (path: string) => void | Promise<void>
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

function normalizePath(input: string): string {
  return input.trim().replaceAll('/', '\\')
}

function isAbsoluteWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path)
}

function extractVolume(path: string): string {
  return path.slice(0, 2).toUpperCase()
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim().length > 0) {
    return value.message
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  return fallback
}

export function DetailPanel({
  details,
  loading,
  canUndo,
  onOpenTarget,
  onDelete,
  onRetarget,
  onUndo,
}: DetailPanelProps) {
  const [editMode, setEditMode] = useState(false)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [retargetValue, setRetargetValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')

  const diff = useMemo(() => {
    if (!details) {
      return null
    }

    return diffSegments(details.target_stored, details.target_real)
  }, [details])

  useEffect(() => {
    setEditMode(false)
    setEditingPath(null)
    setRetargetValue('')
    setBusy(false)
    setError('')
  }, [details?.path])

  if (loading) {
    return (
      <div className="detailPanel detailPanel--loading" role="status" aria-live="polite">
        <div className="detailSection detailSection--skeleton">
          <div className="detailSkeletonLine detailSkeletonLine--wide" />
          <div className="detailSkeletonLine" />
          <div className="detailSkeletonLine detailSkeletonLine--wide" />
          <div className="detailSkeletonLine" />
        </div>
        <div className="detailSection detailSection--skeleton">
          <div className="detailSkeletonLine" />
          <div className="detailSkeletonLine detailSkeletonLine--wide" />
          <div className="detailSkeletonLine" />
          <div className="detailSkeletonLine detailSkeletonLine--wide" />
        </div>
        <div className="detailSkeletonActions">
          <span className="detailSkeletonButton" />
          <span className="detailSkeletonButton" />
          <span className="detailSkeletonButton" />
        </div>
      </div>
    )
  }

  if (!details) {
    return (
      <div className="emptyState">
        <p className="emptyStateTitle">Inspector is waiting</p>
        <p className="emptyStateHint">Choose any row from the registry to see target and metadata.</p>
      </div>
    )
  }

  const sameTarget = details.target_stored === details.target_real
  const attributes = Array.isArray(details.attributes) ? details.attributes : []

  async function runAsyncAction(action: () => void | Promise<void>, fallback: string) {
    if (busy || actionBusy) {
      return
    }

    setActionBusy(true)
    setError('')

    try {
      await action()
    } catch (actionError) {
      setError(getErrorMessage(actionError, fallback))
    } finally {
      setActionBusy(false)
    }
  }

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
            {attributes.map((attribute) => (
              <span className="attributeTag" key={attribute}>
                {attribute}
              </span>
            ))}
            {attributes.length === 0 ? <span className="attributeTag">-</span> : null}
          </span>
        </div>
      </div>

      {editMode ? (
        <div className="retargetInline">
          <input
            disabled={busy}
            value={retargetValue}
            onChange={(event) => setRetargetValue(event.target.value)}
            placeholder="New target path"
          />
          <button
            className="button button--primary"
            disabled={busy || actionBusy || retargetValue.trim().length === 0}
            onClick={async () => {
              const pathToRetarget = editingPath ?? details.path
              const normalizedTarget = normalizePath(retargetValue)

              if (!pathToRetarget) {
                setError('No link selected for retarget.')
                return
              }

              if (!normalizedTarget) {
                setError('Target path is required.')
                return
              }

              if (normalizePath(pathToRetarget).toLowerCase() === normalizedTarget.toLowerCase()) {
                setError('Target path must be different from the link path.')
                return
              }

              if (details.link_type === 'Junction' && !isAbsoluteWindowsPath(normalizedTarget)) {
                setError('Junction target must be an absolute path.')
                return
              }

              if (details.link_type === 'Hardlink') {
                if (!isAbsoluteWindowsPath(normalizedTarget)) {
                  setError('Hardlink target must be an absolute file path.')
                  return
                }

                const normalizedLinkPath = normalizePath(pathToRetarget)
                if (
                  isAbsoluteWindowsPath(normalizedLinkPath) &&
                  extractVolume(normalizedLinkPath) !== extractVolume(normalizedTarget)
                ) {
                  setError('Hardlink requires source and target to be on the same volume.')
                  return
                }
              }

              setBusy(true)
              setError('')
              try {
                await onRetarget(pathToRetarget, normalizedTarget)
                setEditMode(false)
                setEditingPath(null)
                setRetargetValue('')
              } catch (retargetError) {
                setError(getErrorMessage(retargetError, 'Retarget failed'))
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
            disabled={busy}
            onClick={() => {
              setEditMode(false)
              setEditingPath(null)
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
        <button
          className="button"
          disabled={busy || actionBusy}
          onClick={() =>
            void runAsyncAction(() => onOpenTarget(details.target_real), 'Unable to open target')
          }
          type="button"
        >
          Open target
        </button>
        <button
          className="button"
          disabled={busy || actionBusy}
          onClick={() => {
            setRetargetValue(details.target_stored)
            setEditingPath(details.path)
            setError('')
            setEditMode(true)
          }}
          type="button"
        >
          Retarget
        </button>
        <button
          className="button button--danger"
          disabled={busy || actionBusy}
          onClick={() => void runAsyncAction(() => onDelete(details.path), 'Delete failed')}
          type="button"
        >
          Delete
        </button>
        {canUndo ? (
          <button
            className="button"
            disabled={busy || actionBusy}
            onClick={() => void runAsyncAction(() => onUndo(), 'Undo failed')}
            type="button"
          >
            Undo
          </button>
        ) : null}
      </div>
    </div>
  )
}
