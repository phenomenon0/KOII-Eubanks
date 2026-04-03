import { DevicePanel } from '../components/DevicePanel'
import { SoundLibrary } from '../panels/SoundLibrary'
import { BankTabs } from '../components/BankTabs'

export function DeviceTab() {
  // Backup modal is owned by App.tsx (triggered via ko:showBackup global event)
  return (
    <div className="device-tab-layout">
      {/* Left: EP-133 device visualization */}
      <DevicePanel />

      {/* Center: Sample library */}
      <SoundLibrary />

      {/* Right: Bank tabs */}
      <BankTabs />
    </div>
  )
}
