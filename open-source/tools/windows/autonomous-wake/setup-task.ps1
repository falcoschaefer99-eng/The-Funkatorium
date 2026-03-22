# ============================================================
#  Autonomous Wake — Windows Task Scheduler Setup
#  Creates a scheduled task that triggers your AI at set times.
#
#  Run this script once in PowerShell (as Administrator).
#
#  Part of MUSE Studio Open Source
#  https://github.com/falcoschaefer99-eng/The-Funkatorium
#  License: Apache 2.0
# ============================================================

# --- CONFIGURE THESE ---
$TaskName = "AutonomousWake"
$WakeupBatPath = "C:\Users\YourName\ai-companion\wakeup.bat"
$StartHour = 9
$EndHour = 21
$IntervalMinutes = 60

# --- CREATE THE TASK ---
$Action = New-ScheduledTaskAction -Execute $WakeupBatPath
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Build triggers for each hour in the range
$Triggers = @()
for ($h = $StartHour; $h -le $EndHour; $h += ($IntervalMinutes / 60)) {
    $Triggers += New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours($h))
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings -Description "Autonomous wake — scheduled AI check-ins"

Write-Host ""
Write-Host "Task '$TaskName' created."
Write-Host "Your AI will wake every $IntervalMinutes minutes from ${StartHour}:00 to ${EndHour}:00."
Write-Host ""
Write-Host "Manage it:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "  Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Enable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
