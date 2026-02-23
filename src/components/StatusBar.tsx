interface StatusBarProps {
  symlinks: number
  hardlinks: number
  working: number
  broken: number
  junctions: number
  total: number
  visible: number
  scanning: boolean
  volume: string
  method: string
  fastMode: boolean
}

export function StatusBar({
  symlinks,
  hardlinks,
  working,
  broken,
  junctions,
  total,
  visible,
  scanning,
  volume,
  method,
  fastMode,
}: StatusBarProps) {
  return (
    <footer className="statusBar">
      <span className="statusMetric">{symlinks.toLocaleString()} symlinks</span>
      <span className="statusMetric">{hardlinks.toLocaleString()} hardlinks</span>
      <span className="statusMetric">{working.toLocaleString()} working</span>
      <span className="statusMetric">{broken.toLocaleString()} broken</span>
      <span className="statusMetric">{junctions.toLocaleString()} junctions</span>
      <span className="statusMetric">{visible.toLocaleString()} / {total.toLocaleString()} visible</span>
      <span className="statusSpacer" />
      <span>
        {volume} | {method}
      </span>
      <span className={`statusMetric statusEngine ${fastMode ? 'statusEngine--fast' : 'statusEngine--compat'}`}>
        FAST {fastMode ? 'ON' : 'OFF'}
      </span>
      {scanning ? (
        <span className="statusMetric statusMetric--scan">
          Scan active
        </span>
      ) : null}
    </footer>
  )
}
