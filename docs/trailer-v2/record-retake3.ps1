# record-retake3.ps1 - re-record the 13 broken clips with 100% CDP input.
#
# Why CDP: retake 2 recorded garbage because SendKeys/mouse_event are
# focus-routed - the keystrokes went to the user's other browser while the
# clicks (coordinate-routed) still landed on Chrome. This director drives
# every click/type/key/wheel through CDP Input.* which reach the tab's
# renderer regardless of OS foreground, so the run only needs the window
# VISIBLE (foreground + topmost held for the duration), never focused per
# keystroke. Every scene ends with a post-condition verification that
# aborts loudly on a miss.
#
# Prereq: prep3.ps1 ran green (coords3.json + interaction tests + vault
# ground truth 15/2, chrome-dev unfaved, SO active).
#
# Scene list (same 13 as retake 2): c04, c07, c09, c10, c11, c12, c13,
# c14, c15, c16, c17, c18, c19. Kept clips (c01-c03, c05, c06, c08, c20)
# are never touched.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. "$PSScriptRoot\director.ps1"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32f {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

function Focus-Verified {
  param([IntPtr]$Hwnd, [int]$Tries = 40)
  for ($i = 0; $i -lt $Tries; $i++) {
    if ([Win32f]::IsIconic($Hwnd)) { [Win32f]::ShowWindow($Hwnd, 9) | Out-Null }
    [Win32f]::SetForegroundWindow($Hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    if ([Win32f]::GetForegroundWindow() -eq $Hwnd) { return $true }
    Start-Sleep -Milliseconds 450
  }
  return $false
}

# Lag-proof clip start: launch ffmpeg, then poll the output until frames flow.
function Start-Clip2 {
  param([string]$Name, $Rect, [double]$Seconds = 6)
  $out = "D:\PROJECTS\CofreTabs\docs\trailer-v2\clips\$Name.mp4"
  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
  # remove the old clip FIRST: with -y the file is truncated at open, and
  # polling would otherwise compare the fresh recording against the stale
  # pre-delete size and trip the deadline while capture is fine.
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FFMPEG
  $psi.Arguments = "-y -f gdigrab -framerate 30 -draw_mouse 1 -offset_x $($Rect.X) -offset_y $($Rect.Y) -video_size $($Rect.W)x$($Rect.H) -i desktop -t $Seconds -c:v libx264 -preset ultrafast -crf 14 -pix_fmt yuv420p -movflags +faststart `"$out`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $Global:RecordProc = [System.Diagnostics.Process]::Start($psi)
  # ffmpeg flushes the output rarely (~256KB bursts seconds apart), so
  # comparing size deltas can never see two consecutive growths. File
  # creation happens right after the gdigrab input opens, so requiring a
  # non-empty file on two consecutive polls is the reliable "capture
  # started" signal.
  $deadline = [DateTime]::Now.AddSeconds(16)
  $seen = 0
  while ([DateTime]::Now -lt $deadline -and $seen -lt 2) {
    Start-Sleep -Milliseconds 350
    $sz = 0
    if (Test-Path $out) { $sz = (Get-Item $out).Length }
    if ($sz -gt 0) { $seen++ } else { $seen = 0 }
  }
  if ($seen -lt 2) { throw "gdigrab did not produce frames for $Name" }
  Start-Sleep -Milliseconds 700
  Write-Host "recording $Name for ${Seconds}s -> $out"
}

# --------------------------------------------------------------------------
# CDP helpers (all coordinates are VIEWPORT px; the visible cursor glide
# converts to screen with +95 Y, the verified client offset of the window)
# --------------------------------------------------------------------------
function Cdp {
  param([string[]]$A)
  $out = & node "$PSScriptRoot\cdp.mjs" @A 2>&1
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) { throw "cdp $($A -join ' ') [exit=$code]:`n$($out | Out-String)" }
  return ($out | Out-String).Trim()
}
function EV {
  param([string]$Spec, [string]$Expr)
  $out = & node "$PSScriptRoot\cdp.mjs" eval $Spec $Expr 2>&1
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) { throw "eval on $Spec [exit=$code]:`n$($out | Out-String)" }
  return (($out | Out-String).Trim().Trim('"'))
}
function EVF {
  param([string]$Spec, [string]$File)
  $out = & node "$PSScriptRoot\cdp.mjs" evalfile $Spec $File 2>&1
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) { throw "evalfile $(Split-Path $File -Leaf) on $Spec [exit=$code]:`n$($out | Out-String)" }
  return ($out | Out-String).Trim()
}
function Tap {
  param([string]$Spec, $Pt, [int]$Glide = 500)
  Move-Mouse -X ([int]$Pt[0]) -Y ([int]$Pt[1] + 95) -Ms $Glide
  $out = & node "$PSScriptRoot\cdp.mjs" click $Spec ([int]$Pt[0]) ([int]$Pt[1]) 2>&1
  if ($LASTEXITCODE -ne 0) { throw "click on $Spec failed: $($out | Out-String)" }
}
function CType {
  param([string]$Spec, [string]$Text, [int]$Delay = 130)
  $out = & node "$PSScriptRoot\cdp.mjs" type $Spec $Text $Delay 2>&1
  if ($LASTEXITCODE -ne 0) { throw "type on $Spec failed: $($out | Out-String)" }
}
function CKey {
  param([string]$Spec, [string]$Keys)
  $out = & node "$PSScriptRoot\cdp.mjs" key $Spec $Keys 2>&1
  if ($LASTEXITCODE -ne 0) { throw "key '$Keys' on $Spec failed: $($out | Out-String)" }
}
function CWheel {
  param([string]$Spec, [int]$X, [int]$Y, [int]$Delta)
  $out = & node "$PSScriptRoot\cdp.mjs" wheel $Spec $X $Y $Delta 2>&1
  if ($LASTEXITCODE -ne 0) { throw "wheel on $Spec failed: $($out | Out-String)" }
}
function Assert {
  param([string]$What, [string]$Got, [string]$Want)
  if ($Got -ne $Want) { throw "VERIFY FAILED [$What]: got '$Got', want '$Want'" }
  Write-Host "verify ok: $What = $Got"
}
function Get-State {
  return (EVF $FIXS "$PSScriptRoot\fix-state.js" | ConvertFrom-Json)
}

# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------
$COORD = Get-Content "$PSScriptRoot\coords3.json" -Raw | ConvertFrom-Json
$CHROME_URL = 'https://developer.chrome.com/docs/extensions/'
$LIBPREFIX  = 'chrome-extension://cmmmfpoleepkmlbepjjncplcachplinp/src/library'
$CH    = "id:$($COORD.chromeId)"
$FIXS  = "id:$($COORD.fixId)"
$PanelC  = $COORD.panel
$LibC    = $COORD.lib
$GC      = $COORD.folders.githubCard
$NoteC   = $COORD.editor.note
$SaveC   = $COORD.editor.save
$BaseRows      = $COORD.pre.rows
$BaseEditRows  = $COORD.pre.editRows
$RECT = [pscustomobject]@{ X = 0; Y = 0; W = 1920; H = 1040 }

# --------------------------------------------------------------------------
# bring the recording window up, keep it on top for the whole run
# --------------------------------------------------------------------------
$win = Get-ChromeWindow
$hwnd = $win.Hwnd
if (-not (Focus-Verified $hwnd)) { throw 'recording window would not come to the foreground' }
[Win32f]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 3) | Out-Null   # HWND_TOPMOST, no move/resize
$wrect = Get-WindowRect $hwnd
if ($wrect.W -ne 1936 -or $wrect.H -ne 1048) { throw "unexpected window rect $($wrect.W)x$($wrect.H)" }
Write-Host "recording window hwnd=$hwnd rect=$($wrect.X),$($wrect.Y) $($wrect.W)x$($wrect.H) topmost"

# pre-run ground truth (fix.html lives in its own background window)
$st = Get-State
if ($st.active -ne 15 -or $st.trashed -ne 2 -or $st.fav -ne $false -or $st.soActive -ne $true) {
  throw "vault pre-state wrong: $($st | ConvertTo-Json -Compress)"
}

try {

  # ---- c04: search 'godot' (panel open, chrome-dev row 1 unfaved) -------
  Write-Host '--- c04: panel search godot ---'
  Cdp @('activate', $CHROME_URL) | Out-Null
  Assert 'c04 pre: panel open' (EV $CH "String(!!document.getElementById('cofretabs-panel-host'))") 'true'
  Assert 'c04 pre: search empty' (EV $CH "(h=>h?h.shadowRoot.querySelector('input[type=search]').value:'NOHOST')(document.getElementById('cofretabs-panel-host'))") ''
  Start-Clip2 'c04-search' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $CH $PanelC.search 500
  Start-Sleep -Milliseconds 400
  CType $CH 'godot' 130
  Start-Sleep -Milliseconds 2400
  Wait-Clip
  Assert 'c04 typed + filtered' (EV $CH "(h=>{const s=h.shadowRoot;return s.querySelector('input[type=search]').value+'|'+s.querySelectorAll('[data-action=trash-item]').length})(document.getElementById('cofretabs-panel-host'))") 'godot|3'
  # off-camera reset: clear the search, then fill row 1 heart so c07 shows a
  # filled heart (kept c06/c08/c20 continuity; c04 recorded it unfilled)
  $cleared = EV $CH "(h=>{const i=h.shadowRoot.querySelector('input[type=search]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return h.shadowRoot.querySelectorAll('[data-action=trash-item]').length})(document.getElementById('cofretabs-panel-host'))"
  Assert 'off-camera: rows restored' $cleared "$BaseRows"
  Assert 'off-camera: chrome-dev unfaved' ((Get-State).fav.ToString().ToLower()) 'false'
  Tap $CH $PanelC.heart1 500
  Start-Sleep -Milliseconds 600
  Assert 'off-camera: heart filled for c07' ((Get-State).fav.ToString().ToLower()) 'true'

  # ---- c07: trash the Stack Overflow row (row 4) -----------------------
  Write-Host '--- c07: trash Stack Overflow row ---'
  Assert 'c07 pre: SO row visible' (EV $CH "(h=>h?(h.shadowRoot.textContent.includes('Newest')?'PRESENT':'GONE'):'NOHOST')(document.getElementById('cofretabs-panel-host'))") 'PRESENT'
  Start-Clip2 'c07-trash' $RECT 9 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $CH $PanelC.trashSO 500
  Start-Sleep -Milliseconds 2600
  Wait-Clip
  Assert 'c07: SO gone + vault 14' (EV $CH "(h=>{const t=h.shadowRoot.textContent;return (t.includes('Newest')?'SOPRESENT':'SOGONE')+'|'+((t.match(/vault\s*(\d+)\s*tabs/i)||['','?'])[1])})(document.getElementById('cofretabs-panel-host'))") 'SOGONE|14'

  # ---- c09: Escape closes the panel ------------------------------------
  Write-Host '--- c09: Escape closes the panel ---'
  Cdp @('activate', $CHROME_URL) | Out-Null
  Start-Clip2 'c09-escape' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $CH $PanelC.search 500
  Start-Sleep -Milliseconds 700
  CKey $CH 'escape'
  Start-Sleep -Milliseconds 2500
  Wait-Clip
  Assert 'c09: panel closed' (EV $CH "String(!!document.getElementById('cofretabs-panel-host'))") 'false'

  # ---- c10: panel opens, click OPEN LIBRARY (same code path as the
  #      Ctrl+Shift+P command, injected from fix.html - no OS keyboard) ---
  Write-Host '--- c10: panel opens, OPEN LIBRARY ---'
  Start-Clip2 'c10-library' $RECT 12 | Out-Null
  Start-Sleep -Milliseconds 800
  EVF $FIXS "$PSScriptRoot\inject-panel.js" | Out-Null
  Start-Sleep -Milliseconds 1800
  Tap $CH $PanelC.openLib 500
  Start-Sleep -Milliseconds 3000
  Wait-Clip
  Assert 'c10: panel reopened on chrome-dev' (EV $CH "String(!!document.getElementById('cofretabs-panel-host'))") 'true'
  $libLine = (Cdp @('list')) -split "`n" | Where-Object { $_.Contains($LIBPREFIX) } | Select-Object -First 1
  if (-not $libLine) { throw 'c10 verify: library tab did not open' }
  $LIBID = ($libLine -split "`t")[1].Trim()
  $LIBS = "id:$LIBID"
  Write-Host "library tab open: $LIBID"

  # ---- c11: library scroll sweep ---------------------------------------
  Write-Host '--- c11: library scroll sweep ---'
  Cdp @('activate', $LIBPREFIX) | Out-Null
  Start-Clip2 'c11-scroll' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Move-Mouse -X 1100 -Y 505 -Ms 500
  CWheel $LIBS 960 500 600
  Start-Sleep -Milliseconds 600
  CWheel $LIBS 960 500 -600
  Start-Sleep -Milliseconds 600
  Move-Mouse -X 1253 -Y 148 -Ms 450
  Start-Sleep -Milliseconds 400
  Wait-Clip
  Assert 'c11: library alive' (EV $LIBS "String(!!document.querySelector('#search-input'))") 'true'

  # ---- c12: edit note on row 1 -----------------------------------------
  Write-Host '--- c12: edit note on row 1 ---'
  Start-Clip2 'c12-note' $RECT 16 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $LibC.edit1 500
  Start-Sleep -Milliseconds 1000
  Tap $LIBS $NoteC 300
  Start-Sleep -Milliseconds 300
  CType $LIBS 'check against the MV3 docs' 90
  Start-Sleep -Milliseconds 700
  Tap $LIBS $SaveC 500
  Start-Sleep -Milliseconds 2000
  Wait-Clip
  Assert 'c12: dialog closed' (EV $LIBS "String(!document.querySelector('dialog[open]'))") 'true'
  Assert 'c12: note saved' ((Get-State).note) 'check against the MV3 docs'

  # ---- c13: move row 1 into another folder (change commits on the first
  #      arrow of the inline select - deterministic, no native popup) -----
  Write-Host '--- c13: move row 1 to another folder ---'
  $folderBefore = (Get-State).folderId
  Start-Clip2 'c13-move' $RECT 11 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $LibC.move1 500
  Start-Sleep -Milliseconds 700
  Assert 'c13: move menu open' (EV $LIBS "(s=>{if(!s)return 'noselect';s.focus();return 'ok'})(document.querySelector('.move-select'))") 'ok'
  CKey $LIBS 'arrowdown'
  Start-Sleep -Milliseconds 2500
  Start-Sleep -Milliseconds 800
  Wait-Clip
  $folderAfter = (Get-State).folderId
  if ($folderAfter -eq $folderBefore) { throw "VERIFY FAILED [c13 folder]: unchanged ($folderBefore)" }
  Write-Host "verify ok: c13 folderId $folderBefore -> $folderAfter"

  # ---- c14: theme flip dark -> light -> dark (21.125s light crash) ------
  Write-Host '--- c14: theme flip ---'
  Start-Clip2 'c14-theme' $RECT 15 | Out-Null
  Start-Sleep -Milliseconds 800
  Move-Mouse -X ([int]$LibC.theme[0]) -Y ([int]$LibC.theme[1] + 95) -Ms 700
  Assert 'c14: theme starts dark' (EV $LIBS "(s=>{if(!s)return 'nofind';s.focus();return s.value})(document.querySelector('#theme-select'))") 'dark'
  CKey $LIBS 'arrowdown'
  Start-Sleep -Milliseconds 700
  Assert 'c14: flipped to light' (EV $LIBS "document.documentElement.getAttribute('data-theme')") 'light'
  Start-Sleep -Milliseconds 2400
  EV $LIBS "(s=>{s.focus();return 'ok'})(document.querySelector('#theme-select'))" | Out-Null
  CKey $LIBS 'arrowup'
  Start-Sleep -Milliseconds 700
  Assert 'c14: flipped back to dark' (EV $LIBS "document.documentElement.getAttribute('data-theme')") 'dark'
  Start-Sleep -Milliseconds 1500
  Wait-Clip

  # ---- c15: sidebar to the folders grid --------------------------------
  Write-Host '--- c15: folders view ---'
  Start-Clip2 'c15-folders' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $LibC.navFolders 500
  Start-Sleep -Milliseconds 1600
  Move-Mouse -X 1100 -Y 505 -Ms 700
  Move-Mouse -X ([int]$GC[0]) -Y ([int]$GC[1] + 95) -Ms 700
  Start-Sleep -Milliseconds 600
  Wait-Clip
  Assert 'c15: folders view' (EV $LIBS "String(document.body.textContent.includes('WEBSITE FOLDERS'))") 'true'

  # ---- c16: open the GitHub folder card --------------------------------
  Write-Host '--- c16: open GitHub folder ---'
  Start-Clip2 'c16-folder' $RECT 9 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $GC 500
  Start-Sleep -Milliseconds 2500
  Wait-Clip
  Assert 'c16: folder view open' (EV $LIBS "String(document.body.textContent.includes('VAULT / FOLDER'))") 'true'

  # ---- c17: trash view, restore the Stack Overflow row -----------------
  # SO only exists in the trash after c07, so its restore button is
  # measured right here, off camera, before the clip starts.
  Write-Host '--- c17: restore Stack Overflow from trash ---'
  Tap $LIBS $LibC.navTrash 400
  Start-Sleep -Milliseconds 1100
  $restore = EVF $LIBS "$PSScriptRoot\measure-restore3.js" | ConvertFrom-Json
  if (-not $restore.ok) { throw "c17 pre: SO restore button not found in trash ($($restore | ConvertTo-Json -Compress))" }
  Start-Clip2 'c17-restore' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $restore.restoreSO 500
  Start-Sleep -Milliseconds 2500
  Wait-Clip
  $st = Get-State
  if (-not $st.soActive) { throw 'c17 verify: SO not active after restore' }
  if ($st.active -ne 15 -or $st.trashed -ne 2) { throw "c17 verify: expected 15 active / 2 trashed, got $($st.active)/$($st.trashed)" }
  Write-Host 'verify ok: c17 restored SO (15 active / 2 trashed)'

  # ---- c18: back to ALL, search 'wiki' ---------------------------------
  Write-Host '--- c18: library search wiki ---'
  Tap $LIBS $LibC.navAll 400
  Start-Sleep -Milliseconds 1000
  Assert 'c18: all view rows' (EV $LIBS "document.querySelectorAll('[data-action=edit-tab]').length") "$BaseEditRows"
  Start-Clip2 'c18-search' $RECT 10 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $LibC.search 500
  Start-Sleep -Milliseconds 400
  CType $LIBS 'wiki' 130
  Start-Sleep -Milliseconds 2600
  Wait-Clip
  Assert 'c18: search wiki' (EV $LIBS "document.querySelector('#search-input').value") 'wiki'

  # ---- c19: clear the search, idle settle ------------------------------
  Write-Host '--- c19: clear search, idle ---'
  Start-Clip2 'c19-clear' $RECT 9 | Out-Null
  Start-Sleep -Milliseconds 800
  Tap $LIBS $LibC.search 500
  Start-Sleep -Milliseconds 300
  CKey $LIBS 'ctrl+a'
  Start-Sleep -Milliseconds 250
  CKey $LIBS 'delete'
  Start-Sleep -Milliseconds 2600
  Wait-Clip
  Assert 'c19: search cleared' (EV $LIBS "document.querySelector('#search-input').value") ''
  Assert 'c19: rows back' (EV $LIBS "document.querySelectorAll('[data-action=edit-tab]').length") "$BaseEditRows"

  # ---- tidy up for a possible re-run -----------------------------------
  Cdp @('close', "id:$LIBID") | Out-Null
  Start-Sleep -Milliseconds 400
  Cdp @('activate', $CHROME_URL) | Out-Null
  Assert 'post: panel open on chrome-dev' (EV $CH "String(!!document.getElementById('cofretabs-panel-host'))") 'true'
  Write-Host 'RECORD3 DONE - 13 clips recorded, all verifications green'

} finally {
  if ($Global:RecordProc) { Wait-Clip }
  [Win32f]::SetWindowPos($hwnd, [IntPtr](0), 0, 0, 0, 0, 3) | Out-Null   # HWND_NOTOPMOST
  Write-Host 'topmost released'
}
