import { useEffect, useMemo, useState } from 'react'
import type { Config, VolumeInfo } from '../types'

interface SettingsModalProps {
  open: boolean
  volumes: VolumeInfo[]
  config: Config | null
  shellRegistered: boolean
  onClose: () => void
  onConfigChange: (next: Config) => Promise<void>
  onToggleShell: (enabled: boolean) => Promise<void>
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return fallback
}

export function SettingsModal({
  open,
  volumes,
  config,
  shellRegistered,
  onClose,
  onConfigChange,
  onToggleShell,
}: SettingsModalProps) {
  const [pendingExclude, setPendingExclude] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isTogglingShell, setIsTogglingShell] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!open) {
      setPendingExclude('')
      setActionError('')
      setIsSavingConfig(false)
      setIsTogglingShell(false)
    }
  }, [open])

  const excluded = useMemo(() => {
    if (!Array.isArray(config?.scan.excluded_paths)) {
      return []
    }

    return config.scan.excluded_paths
  }, [config])

  const controlsDisabled = isSavingConfig || isTogglingShell

  const applyConfigChange = async (next: Config): Promise<boolean> => {
    if (isSavingConfig || isTogglingShell) {
      return false
    }

    setIsSavingConfig(true)
    setActionError('')

    try {
      await onConfigChange(next)
      return true
    } catch (error) {
      setActionError(normalizeError(error, 'Unable to save settings.'))
      return false
    } finally {
      setIsSavingConfig(false)
    }
  }

  const toggleShell = async (enabled: boolean) => {
    if (isSavingConfig || isTogglingShell) {
      return
    }

    setIsTogglingShell(true)
    setActionError('')

    try {
      await onToggleShell(enabled)
    } catch (error) {
      setActionError(normalizeError(error, 'Unable to update shell integration.'))
    } finally {
      setIsTogglingShell(false)
    }
  }

  if (!open || !config) {
    return null
  }

  return (
    <div className="modalOverlay" onClick={onClose} role="presentation">
      <div className="modalCard modalCard--settings" onClick={(event) => event.stopPropagation()}>
        <h3>Settings</h3>

        <section>
          <h4>Scan</h4>

          <label className="formField">
            <span className="fieldLabel">Default volume</span>
            <span className="fieldHint">Volume used when opening symview.</span>
            <select
              value={config.scan.default_volume}
              disabled={controlsDisabled}
              onChange={(event) =>
                void applyConfigChange({
                  ...config,
                  scan: {
                    ...config.scan,
                    default_volume: event.target.value,
                  },
                })
              }
            >
              {volumes.map((volume) => (
                <option key={volume.letter} value={volume.letter}>
                  {volume.letter}
                </option>
              ))}
            </select>
          </label>

          <label className="checkboxRow">
            <input
              checked={config.scan.auto_scan_on_start}
              disabled={controlsDisabled}
              onChange={(event) =>
                void applyConfigChange({
                  ...config,
                  scan: {
                    ...config.scan,
                    auto_scan_on_start: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            Auto-scan on start
          </label>

          <div className="excludedList">
            {excluded.map((value) => (
              <div key={value} className="excludedItem">
                <span>{value}</span>
                <button
                  className="button"
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() =>
                    void applyConfigChange({
                      ...config,
                      scan: {
                        ...config.scan,
                        excluded_paths: excluded.filter((item) => item !== value),
                      },
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="inputWithButton">
            <input
              placeholder="Add excluded path"
              value={pendingExclude}
              disabled={controlsDisabled}
              onChange={(event) => setPendingExclude(event.target.value)}
            />
            <button
              className="button"
              type="button"
              disabled={controlsDisabled}
              onClick={() => {
                const value = pendingExclude.trim()

                if (!value) {
                  return
                }

                void (async () => {
                  const saved = await applyConfigChange({
                    ...config,
                    scan: {
                      ...config.scan,
                      excluded_paths: [...excluded, value],
                    },
                  })

                  if (saved) {
                    setPendingExclude('')
                  }
                })()
              }}
            >
              Add
            </button>
          </div>
        </section>

        <section>
          <h4>Shell integration</h4>
          <label className="checkboxRow">
            <input
              checked={shellRegistered}
              disabled={controlsDisabled}
              onChange={(event) => {
                void toggleShell(event.target.checked)
              }}
              type="checkbox"
            />
            Add "Open in symview" to Explorer context menu
          </label>
        </section>

        {actionError ? <div className="inlineError">{actionError}</div> : null}

        <div className="modalActions">
          <button className="button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
