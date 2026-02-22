import { useMemo, useState } from 'react'
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

  const excluded = useMemo(() => config?.scan.excluded_paths ?? [], [config])

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
              onChange={(event) =>
                void onConfigChange({
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
              onChange={(event) =>
                void onConfigChange({
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
                  onClick={() =>
                    void onConfigChange({
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
              onChange={(event) => setPendingExclude(event.target.value)}
            />
            <button
              className="button"
              type="button"
              onClick={() => {
                const value = pendingExclude.trim()

                if (!value) {
                  return
                }

                void onConfigChange({
                  ...config,
                  scan: {
                    ...config.scan,
                    excluded_paths: [...excluded, value],
                  },
                })

                setPendingExclude('')
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
              onChange={(event) => {
                void onToggleShell(event.target.checked)
              }}
              type="checkbox"
            />
            Add "Open in symview" to Explorer context menu
          </label>
        </section>

        <div className="modalActions">
          <button className="button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
