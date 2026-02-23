import { CheckCircle, CircleNotch, Lightning, WarningCircle } from '@phosphor-icons/react'

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

const ICON_SIZE = 14

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
      <span className="statusMetric">
        <CheckCircle size={ICON_SIZE} weight="duotone" />
        {working.toLocaleString()} working
      </span>
      <span className="statusMetric">
        <WarningCircle size={ICON_SIZE} weight="duotone" />
        {broken.toLocaleString()} broken
      </span>
      <span className="statusMetric">{junctions.toLocaleString()} junctions</span>
      <span className="statusMetric">{visible.toLocaleString()} / {total.toLocaleString()} visible</span>
      <span className="statusSpacer" />
      <span>
        {volume} | {method}
      </span>
      <span className={`statusMetric statusEngine ${fastMode ? 'statusEngine--fast' : 'statusEngine--compat'}`}>
        <Lightning size={ICON_SIZE} weight="duotone" />
        FAST {fastMode ? 'ON' : 'OFF'}
      </span>
      {scanning ? (
        <span className="statusMetric statusMetric--scan">
          <CircleNotch size={ICON_SIZE} weight="bold" className="statusSpin" />
          Scan active
        </span>
      ) : null}
    </footer>
  )
}
