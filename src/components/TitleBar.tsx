interface TitleBarProps {
  isScanning: boolean
}

export function TitleBar({ isScanning }: TitleBarProps) {
  return (
    <header className="titleBar" data-tauri-drag-region>
      <div className="titleDots" aria-hidden="true">
        <span className="dot dot--close" />
        <span className="dot dot--min" />
        <span className="dot dot--max" />
      </div>
      <div className="titleText">symview</div>
      <div className="titleMeta">NTFS Link Control</div>
      {isScanning ? <div className="scanLine" /> : null}
    </header>
  )
}
