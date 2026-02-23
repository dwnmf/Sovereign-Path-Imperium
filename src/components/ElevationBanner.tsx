interface ElevationBannerProps {
  visible: boolean
  onRestartAsAdmin: () => void
}

export function ElevationBanner({ visible, onRestartAsAdmin }: ElevationBannerProps) {
  if (!visible) {
    return null
  }

  return (
    <div className="elevationBanner">
      <span>symview is running without administrator privileges.</span>
      <span>USN Journal scan unavailable, using slower fallback. Some symlinks may not be visible.</span>
      <button className="button button--warn" onClick={onRestartAsAdmin} type="button">
        Restart as Administrator
      </button>
    </div>
  )
}
