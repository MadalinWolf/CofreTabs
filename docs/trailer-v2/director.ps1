# director.ps1 — screen automation + recording helpers for the CofreTabs trailer.
# Dot-source this file, then use the functions below.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$FFMPEG = 'C:\Users\dinum\AppData\Local\Temp\ffmpeg-essentials\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe'
$Global:RecordProc = $null

function Get-ChromeWindow {
  param([string]$ProfileHint = 'ct-trailer-profile')
  $proc = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
    Where-Object { $_.CommandLine -match $ProfileHint -and $_.CommandLine -notmatch '--type=' } |
    Select-Object -First 1
  if (-not $proc) { throw "recording Chrome (profile $ProfileHint) not found" }
  $p = Get-Process -Id $proc.ProcessId
  for ($i = 0; $i -lt 50 -and $p.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 100; $p.Refresh() }
  if ($p.MainWindowHandle -eq 0) { throw "chrome window handle not available" }
  [pscustomobject]@{ Pid = $proc.ProcessId; Hwnd = $p.MainWindowHandle }
}

function Get-WindowRect {
  param([IntPtr]$Hwnd)
  $r = New-Object Win32+RECT
  [Win32]::GetWindowRect($Hwnd, [ref]$r) | Out-Null
  [pscustomobject]@{ X = $r.Left; Y = $r.Top; W = $r.Right - $r.Left; H = $r.Bottom - $r.Top }
}

function Focus-Window {
  param([IntPtr]$Hwnd)
  if ([Win32]::IsIconic($Hwnd)) { [Win32]::ShowWindow($Hwnd, 9) | Out-Null }
  [Win32]::SetForegroundWindow($Hwnd) | Out-Null
  Start-Sleep -Milliseconds 250
}

function Move-Mouse {
  param([int]$X, [int]$Y, [int]$Ms = 350)
  $cur = [System.Windows.Forms.Cursor]::Position
  $steps = [Math]::Max(8, [int]($Ms / 12))
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $e = [Math]::Sin($t * [Math]::PI / 2)  # ease-out
    $nx = [int]($cur.X + ($X - $cur.X) * $e)
    $ny = [int]($cur.Y + ($Y - $cur.Y) * $e)
    [Win32]::SetCursorPos($nx, $ny) | Out-Null
    Start-Sleep -Milliseconds ([Math]::Max(4, [int]($Ms / $steps)))
  }
  [Win32]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
}

function Click {
  param([int]$X, [int]$Y, [int]$MoveMs = 300)
  Move-Mouse -X $X -Y $Y -Ms $MoveMs
  Start-Sleep -Milliseconds 80
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
  Start-Sleep -Milliseconds 55
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
  Start-Sleep -Milliseconds 120
}

function Type-Text {
  param([string]$Text, [int]$DelayMs = 75)
  foreach ($ch in $Text.ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait($ch)
    Start-Sleep -Milliseconds $DelayMs
  }
}

function Send-Keys {
  param([string]$Keys)
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds 150
}

function Shot {
  param([string]$Path, $Rect = $null)
  if (-not $Rect) { $Rect = Get-WindowRect (Get-ChromeWindow).Hwnd }
  $bmp = New-Object System.Drawing.Bitmap($Rect.W, $Rect.H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($Rect.X, $Rect.Y, 0, 0, $bmp.Size)
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
  Write-Host "shot: $Path"
}

function Start-Clip {
  param(
    [string]$Name,
    $Rect,
    [double]$Seconds = 6
  )
  $out = "D:\PROJECTS\CofreTabs\docs\trailer-v2\clips\$Name.mp4"
  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FFMPEG
  $psi.Arguments = "-y -f gdigrab -framerate 30 -draw_mouse 1 -offset_x $($Rect.X) -offset_y $($Rect.Y) -video_size $($Rect.W)x$($Rect.H) -i desktop -t $Seconds -c:v libx264 -preset ultrafast -crf 14 -pix_fmt yuv420p -movflags +faststart `"$out`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $Global:RecordProc = [System.Diagnostics.Process]::Start($psi)
  Start-Sleep -Milliseconds 900   # let gdigrab warm up & settle
  Write-Host "recording $Name for ${Seconds}s -> $out"
  $out
}

function Stop-Clip {
  if ($Global:RecordProc) {
    $Global:RecordProc.WaitForExit(15000) | Out-Null
    Write-Host "clip done: $($Global:RecordProc.ExitCode)"
    $Global:RecordProc = $null
  }
}

function Wait-Clip {
  if ($Global:RecordProc) { $Global:RecordProc.WaitForExit(20000) | Out-Null; $Global:RecordProc = $null }
}

Write-Host "director loaded. FFMPEG=$FFMPEG"
