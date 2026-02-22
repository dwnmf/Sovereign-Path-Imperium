import { Pulse } from '@phosphor-icons/react'

interface TitleBarProps {
  isScanning: boolean
}

const ICON_SIZE = 13

export function TitleBar({ isScanning }: TitleBarProps) {
  return (
    <header className="titleBar" data-tauri-drag-region>
      <div className="titleDots" aria-hidden="true">
        <span className="dot dot--close" />
        <span className="dot dot--min" />
        <span className="dot dot--max" />
      </div>
      <div className="titleText">
        <span>symview</span>
        {isScanning ? (
          <span className="titleBadge">
            <Pulse size={ICON_SIZE} weight="duotone" />
            scanning
          </span>
        ) : (
          <span className="titleBadge titleBadge--idle">ready</span>
        )}
      </div>
      <div className="titleMeta">NTFS Link Control</div>
      {isScanning ? <div className="scanLine" /> : null}
    </header>
  )
}
