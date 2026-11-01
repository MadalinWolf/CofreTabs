# prep3.ps1 - headless (CDP-only) prep for retake pass 3.
#
# Why CDP: retake 2 recorded garbage because SendKeys/mouse_event are
# focus-routed - the keystrokes went to the user's other browser while the
# clicks (coordinate-routed) still landed on Chrome. This pass drives every
# interaction through CDP Input.* / Runtime.evaluate, which reach the tab's
# renderer regardless of OS foreground, so prep needs no focus at all.
#
# What it does:
#   0. window rect sanity (gdigrab region for record3)
#   1. tab hygiene (canonical 7 tabs; leaves chrome://intro in its own window)
#   2. fix.html in a BACKGROUND window (chrome.* access, never in the strip)
#   3. inject the panel into chrome-dev (same code path as Ctrl+Shift+P)
#   4. vault ground-truth assert (15/2, chrome-dev unfaved, SO active)
#   5. measure the panel; TEST the two fragile input paths:
#        - CDP click focuses the panel search  (c04)
#        - CDP Escape closes the panel        (c09)
#      then re-inject + re-measure
#   6. create the library tab; measure nav/search/theme/row1 edit+move;
#      measure the folders-view GitHub card; measure the edit dialog
#      (opens then cancels); TEST the move menu (opens then Escape-restores)
#   7. write coords3.json for record-retake3.ps1
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. "$PSScriptRoot\director.ps1"

$EXT = 'cmmmfpoleepkmlbepjjncplcachplinp'
$CHROME_URL = 'https://developer.chrome.com/docs/extensions/'
$LIB_URL = "chrome-extension://$EXT/src/library/library.html"
$FIX_URL = "chrome-extension://$EXT/fix.html"

function Cdp {
  param([string[]]$A)
  $out = & node "$PSScriptRoot\cdp.mjs" @A 2>&1
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) { throw "cdp $($A -join ' ') [exit=$code]:`n$($out | Out-String)" }
  return ($out | Out-String).Trim()
}
function EvalF {
  param([string]$Spec, [string]$File)
  $out = & node "$PSScriptRoot\cdp.mjs" evalfile $Spec $File 2>&1
  if ($LASTEXITCODE -ne 0) { throw "evalfile $(Split-Path $File -Leaf) on $Spec failed:`n$($out | Out-String)" }
  return ($out | Out-String).Trim()
}
function EvalQ {
  param([string]$Spec, [string]$Expr)
  $out = & node "$PSScriptRoot\cdp.mjs" eval $Spec $Expr 2>&1
  if ($LASTEXITCODE -ne 0) { throw "eval on $Spec failed:`n$($out | Out-String)" }
  return (($out | Out-String).Trim().Trim('"'))
}
function Tap {
  param([string]$Spec, $Pt, [int]$Glide = 500)
  Move-Mouse -X ([int]$Pt[0]) -Y ([int]$Pt[1] + 95) -Ms $Glide
  $r = & node "$PSScriptRoot\cdp.mjs" click $Spec ([int]$Pt[0]) ([int]$Pt[1]) 2>&1
  if ($LASTEXITCODE -ne 0) { throw "click on $Spec failed: $($r | Out-String)" }
}

Write-Host '=== prep3 ==='

# --- 0. window rect (gdigrab region) ------------------------------------
$win = Get-ChromeWindow
$rect = Get-WindowRect $win.Hwnd
Write-Host "window pid=$($win.Pid) hwnd=$($win.Hwnd) rect=$($rect.X),$($rect.Y) $($rect.W)x$($rect.H)"
if ($rect.X -ne -8 -or $rect.Y -ne -8 -or $rect.W -ne 1936 -or $rect.H -ne 1048) {
  throw "unexpected window rect - expected -8,-8 1936x1048 (wrong window picked?)"
}

# --- 1. tab hygiene -----------------------------------------------------
$allow = @(
  'developer.chrome.com/docs/extensions', 'web.dev/', 'news.ycombinator.com',
  'godotengine.org', 'itch.io', 'developer.mozilla.org', 'github.com/MadalinWolf/CofreTabs'
)
$CHROMEID = $null
$listing = Cdp @('list')
foreach ($line in ($listing -split "`n")) {
  $p = $line -split "`t"
  if ($p.Count -lt 3) { continue }
  $tid = $p[1].Trim(); $url = $p[2].Trim()
  if ($url.StartsWith($CHROME_URL)) { $CHROMEID = $tid }
  if ($url.StartsWith($FIX_URL) -or $url.StartsWith($LIB_URL)) {
    Write-Host "closing leftover: $url"
    Cdp @('close', "id:$tid") | Out-Null
    continue
  }
  if ($url -like 'chrome://*') { continue }   # chrome://intro lives in its own window
  $keep = $false
  foreach ($a in $allow) { if ($url.Contains($a)) { $keep = $true } }
  if (-not $keep) { Write-Host "closing stray: $url"; Cdp @('close', "id:$tid") | Out-Null }
}
if (-not $CHROMEID) { throw 'chrome-dev tab not found' }
Cdp @('activate', $CHROME_URL) | Out-Null
Write-Host "chrome-dev id: $CHROMEID"

# --- 2. fix.html in a background window ---------------------------------
$FIX = Cdp @('create', $FIX_URL, 'newwin')
$FIXSPEC = "id:$FIX"
Write-Host "fix target (background window): $FIX"
Start-Sleep -Milliseconds 900

# --- 3. inject the panel (extension code path, no OS input) -------------
EvalF $FIXSPEC "$PSScriptRoot\inject-panel.js" | Out-Null
Start-Sleep -Milliseconds 1500   # let the slide-in settle before measuring

# --- 4. vault ground truth ----------------------------------------------
$state = EvalF $FIXSPEC "$PSScriptRoot\fix-state.js" | ConvertFrom-Json
if ($state.active -ne 15 -or $state.trashed -ne 2 -or $state.fav -ne $false -or $state.soActive -ne $true) {
  throw "vault state wrong: $($state | ConvertTo-Json -Compress)"
}
Write-Host "vault ok: $($state.active) active / $($state.trashed) trashed, chrome-dev fav=$($state.fav), SO active=$($state.soActive)"

# --- 5. measure panel + input-path tests --------------------------------
$CH = "id:$CHROMEID"
$panel = EvalF $CH "$PSScriptRoot\measure-panel3.js" | ConvertFrom-Json
if (-not $panel.ok) { throw "panel measurement incomplete: $($panel | ConvertTo-Json -Compress)" }
if ($panel.searchVal -ne '') { throw "panel search not empty: '$($panel.searchVal)'" }
if ($panel.vault -ne 15) { throw "panel vault header shows $($panel.vault), expected 15" }
Write-Host "panel measured: rows=$($panel.rows) vault=$($panel.vault) search=$($panel.search -join ',')"

# test A: CDP click focuses the search input (c04's action)
Tap $CH $panel.search 450
Start-Sleep -Milliseconds 250
$focusOk = EvalQ $CH "(h=>h?String(h.shadowRoot.activeElement===h.shadowRoot.querySelector('input[type=search]')):'nohost')(document.getElementById('cofretabs-panel-host'))"
if ($focusOk -ne 'true') { throw "CDP click did not focus the panel search (got '$focusOk')" }
Write-Host 'test OK: CDP click -> panel search focused'

# test B: CDP Escape closes the panel (c09's action)
Cdp @('key', $CH, 'escape') | Out-Null
Start-Sleep -Milliseconds 700
$hostAfter = EvalQ $CH "String(!!document.getElementById('cofretabs-panel-host'))"
if ($hostAfter -ne 'false') { throw "CDP Escape did not close the panel (host still: $hostAfter)" }
Write-Host 'test OK: CDP Escape -> panel closed'

# re-inject for the real pass, re-measure
EvalF $FIXSPEC "$PSScriptRoot\inject-panel.js" | Out-Null
Start-Sleep -Milliseconds 1500
$panel = EvalF $CH "$PSScriptRoot\measure-panel3.js" | ConvertFrom-Json
if (-not $panel.ok -or $panel.searchVal -ne '') { throw "post-reinject measure failed: $($panel | ConvertTo-Json -Compress)" }
Write-Host "panel re-injected: rows=$($panel.rows) vault=$($panel.vault)"

# --- 6. library measurements + interaction tests ------------------------
$LIBID = Cdp @('create', $LIB_URL)
$LIBSPEC = "id:$LIBID"
Write-Host "library target: $LIBID"
Start-Sleep -Milliseconds 1300
$lib = EvalF $LIBSPEC "$PSScriptRoot\measure-library3.js" | ConvertFrom-Json
if (-not $lib.ok) { throw "library measurement incomplete: $($lib | ConvertTo-Json -Compress)" }
if ($lib.searchVal -ne '') { throw "library search not empty: '$($lib.searchVal)'" }
if (($lib.themeOpts -join ',') -ne 'dark,light') { throw "theme options unexpected: $($lib.themeOpts -join ',')" }
if ($lib.themeAttr -ne 'dark') { throw "theme is '$($lib.themeAttr)', expected dark" }
$sortVal = EvalQ $LIBSPEC "document.querySelector('#sort-select').value"
if ($sortVal -ne 'newest') { throw "library sort is '$sortVal', expected newest (row1 must be chrome-dev)" }
Write-Host "library measured: edit1=$($lib.edit1 -join ',') move1=$($lib.move1 -join ',') theme=$($lib.theme -join ',') rows=$($lib.editRows) scroll=$($lib.scrollH)/$($lib.clientH)"

# test C: nav click works on the library page (CDP click path)
Tap $LIBSPEC $lib.navFolders 450
Start-Sleep -Milliseconds 900
$folders = EvalF $LIBSPEC "$PSScriptRoot\measure-folders3.js" | ConvertFrom-Json
if (-not $folders.ok -or -not $folders.header) {
  throw "folders view did not open after clicking nav (CDP click path broken): $($folders | ConvertTo-Json -Compress)"
}
Write-Host "test OK: nav click -> folders view, github card at $($folders.githubCard -join ',')"
Tap $LIBSPEC $lib.navAll 450
Start-Sleep -Milliseconds 800

# test D: edit dialog opens (c12) then cancel
Tap $LIBSPEC $lib.edit1 450
Start-Sleep -Milliseconds 700
$editor = EvalF $LIBSPEC "$PSScriptRoot\measure-editor3.js" | ConvertFrom-Json   # also closes the dialog
if (-not $editor.ok) { throw "edit dialog did not open: $($editor | ConvertTo-Json -Compress)" }
Start-Sleep -Milliseconds 400
$dlgGone = EvalQ $LIBSPEC "String(!document.querySelector('dialog[open]'))"
if ($dlgGone -ne 'true') { throw "edit dialog did not cancel" }
Write-Host "test OK: edit dialog open+cancel, note=$($editor.note -join ',') save=$($editor.save -join ',')"

# test E: move menu opens, Escape restores (c13's action, no mutation)
Tap $LIBSPEC $lib.move1 450
Start-Sleep -Milliseconds 600
$mv = EvalQ $LIBSPEC "(s=>{if(!s)return 'noselect';s.focus();return 'ok'})(document.querySelector('.move-select'))"
if ($mv -ne 'ok') { throw "move menu did not open (got '$mv')" }
Cdp @('key', $LIBSPEC, 'escape') | Out-Null
Start-Sleep -Milliseconds 800
$mvGone = EvalQ $LIBSPEC "String(!document.querySelector('.move-select'))"
if ($mvGone -ne 'true') { throw "move menu did not close on Escape" }
$state2 = EvalF $FIXSPEC "$PSScriptRoot\fix-state.js" | ConvertFrom-Json
if ($state2.folderId -ne $state.folderId) { throw "move test mutated folderId: $($state.folderId) -> $($state2.folderId)" }
Write-Host "test OK: move menu open+Escape, folder unchanged ($($state.folderId))"

# --- 7. back to chrome-dev, final checks, write coords ------------------
Cdp @('close', "id:$LIBID") | Out-Null
Start-Sleep -Milliseconds 500
Cdp @('activate', $CHROME_URL) | Out-Null
Start-Sleep -Milliseconds 300
$finalHost = EvalQ $CH "String(!!document.getElementById('cofretabs-panel-host'))"
if ($finalHost -ne 'true') { throw "panel not open on chrome-dev at end of prep (host=$finalHost)" }

$coords = [ordered]@{
  fixId    = $FIX
  chromeId = $CHROMEID
  rect     = @{ X = $rect.X; Y = $rect.Y; W = $rect.W; H = $rect.H }
  panel    = $panel
  lib      = $lib
  folders  = $folders
  editor   = $editor
  pre      = @{ folderId = $state.folderId; rows = $panel.rows; editRows = $lib.editRows }
}
$coords | ConvertTo-Json -Depth 8 | Set-Content "$PSScriptRoot\coords3.json" -Encoding UTF8
Write-Host "PREP3 OK -> coords3.json"
