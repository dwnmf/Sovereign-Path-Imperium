import { useMemo, useState } from 'react'
import type { LinkType } from '../types'

interface CreateModalProps {
  open: boolean
  existingPaths: Set<string>
  onClose: () => void
  onSubmit: (payload: {
    linkPath: string
    targetPath: string
    linkType: LinkType
    targetIsDir: boolean
  }) => Promise<void>
}

function normalizePath(input: string): string {
  return input.trim().replaceAll('/', '\\')
}

function extractVolume(path: string): string {
  return path.slice(0, 2).toUpperCase()
}

export function CreateModal({ open, existingPaths, onClose, onSubmit }: CreateModalProps) {
  const [linkPath, setLinkPath] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [linkType, setLinkType] = useState<LinkType>('Symlink')
  const [targetIsDir, setTargetIsDir] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const warning = useMemo(() => {
    const normalizedTarget = normalizePath(targetPath)

    if (linkType === 'Hardlink') {
      const sameVolume =
        normalizePath(linkPath).length >= 2 && normalizedTarget.length >= 2
          ? extractVolume(linkPath) === extractVolume(normalizedTarget)
          : true

      if (!sameVolume) {
        return 'Hardlink usually requires source and target to be on the same volume.'
      }
    }

    if (linkType === 'Junction' && !/^[A-Za-z]:\\/.test(normalizedTarget)) {
      return 'Junction target should be an absolute path.'
    }

    return ''
  }, [linkPath, linkType, targetPath])

  if (!open) {
    return null
  }

  return (
    <div className="modalOverlay" onClick={onClose} role="presentation">
      <div className="modalCard" onClick={(event) => event.stopPropagation()}>
        <h3>Create Link</h3>

        <label className="formField">
          <span className="fieldLabel">Link path</span>
          <span className="fieldHint">Absolute path where the link will be created.</span>
          <div className="inputWithButton">
            <input value={linkPath} onChange={(event) => setLinkPath(event.target.value)} />
            <button
              className="button"
              type="button"
              onClick={() => {
                const value = window.prompt('Enter link path', linkPath)
                if (value) {
                  setLinkPath(value)
                }
              }}
            >
              Browse
            </button>
          </div>
        </label>

        <label className="formField">
          <span className="fieldLabel">Target path</span>
          <span className="fieldHint">Resolved destination for the link pointer.</span>
          <div className="inputWithButton">
            <input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
            <button
              className="button"
              type="button"
              onClick={() => {
                const value = window.prompt('Enter target path', targetPath)
                if (value) {
                  setTargetPath(value)
                }
              }}
            >
              Browse
            </button>
          </div>
        </label>

        <fieldset className="radioGroup">
          <legend>Type</legend>
          {(['Symlink', 'Junction', 'Hardlink'] as LinkType[]).map((value) => (
            <label key={value}>
              <input
                checked={linkType === value}
                name="linkType"
                onChange={() => setLinkType(value)}
                type="radio"
              />
              {value}
            </label>
          ))}
        </fieldset>

        {linkType === 'Symlink' ? (
          <label className="checkboxRow">
            <input
              checked={targetIsDir}
              onChange={(event) => setTargetIsDir(event.target.checked)}
              type="checkbox"
            />
            Target is directory
          </label>
        ) : null}

        {warning ? <div className="inlineWarning">{warning}</div> : null}
        {error ? <div className="inlineError">{error}</div> : null}

        <div className="modalActions">
          <button className="button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={isSaving}
            type="button"
            onClick={async () => {
              const normalizedLink = normalizePath(linkPath)
              const normalizedTarget = normalizePath(targetPath)

              setError('')

              if (!normalizedLink) {
                setError('Link path is required.')
                return
              }

              if (!normalizedTarget) {
                setError('Target path is required.')
                return
              }

              if (existingPaths.has(normalizedLink.toLowerCase())) {
                setError('Link path already exists in current dataset.')
                return
              }

              setIsSaving(true)

              try {
                await onSubmit({
                  linkPath: normalizedLink,
                  targetPath: normalizedTarget,
                  linkType,
                  targetIsDir,
                })

                setLinkPath('')
                setTargetPath('')
                setLinkType('Symlink')
                setTargetIsDir(false)
                onClose()
              } catch (submitError) {
                setError(submitError instanceof Error ? submitError.message : 'Creation failed')
              } finally {
                setIsSaving(false)
              }
            }}
          >
            {isSaving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
