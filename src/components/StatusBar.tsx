interface StatusBarProps {
  working: number
  broken: number
  junctions: number
  volume: string
  method: string
}

export function StatusBar({ working, broken, junctions, volume, method }: StatusBarProps) {
  return (
    <footer className="statusBar">
      <span>{working.toLocaleString()} working</span>
      <span>{broken.toLocaleString()} broken</span>
      <span>{junctions.toLocaleString()} junctions</span>
      <span className="statusSpacer" />
      <span>
        {volume} | {method}
      </span>
    </footer>
  )
}
