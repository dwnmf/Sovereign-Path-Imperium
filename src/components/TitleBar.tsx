interface TitleBarProps {
  isScanning: boolean
}

export function TitleBar({ isScanning }: TitleBarProps) {
  return (
    <header className="titleBar" data-tauri-drag-region>
      <div className="titleText">
        <span>symview</span>
        {isScanning ? (
          <span className="titleBadge">scanning</span>
        ) : (
          <span className="titleBadge titleBadge--idle">ready</span>
        )}
      </div>
      <div className="titleMeta">NTFS Link Control</div>
      {isScanning ? <div className="scanLine" /> : null}
    </header>
  )
}
