# Render the PNG icons from web/icon.svg with headless Microsoft Edge.
#   icon-192.png, icon-512.png  rounded tile on a transparent background (PWA manifest)
#   apple-touch-icon.png        clip removed, full-bleed square: iOS applies its own mask
#                               and would paint transparent corners black
# Each size is downscaled from one 1024px render, because headless Edge renders small
# windows blank.
# Known limits: Windows only; needs Microsoft Edge and System.Drawing.

$ErrorActionPreference = 'Stop'
$web = (Resolve-Path (Join-Path $PSScriptRoot '..\web')).Path
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) 'remote-music-icons'
New-Item -ItemType Directory -Force $tmp | Out-Null
Add-Type -AssemblyName System.Drawing

function Render-Master([string]$svg, [string]$png) {
  $url = 'file:///' + ($svg -replace '\\', '/')
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    "--user-data-dir=$tmp\profile" --default-background-color=00000000 `
    '--window-size=1024,1024' "--screenshot=$png" $url 2>$null | Out-Null
  if (-not (Test-Path $png)) { throw "Edge did not write $png" }
}

function Save-Size([string]$master, [int]$size, [string]$out) {
  $src = [Drawing.Image]::FromFile($master)
  $bmp = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.CompositingQuality = 'HighQuality'
  # Mirror the edge while resampling: the default blends in transparent pixels from
  # outside the image, leaving a half-transparent rim that iOS would darken
  $attr = New-Object Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dest = New-Object Drawing.Rectangle 0, 0, $size, $size
  $g.DrawImage($src, $dest, 0, 0, $src.Width, $src.Height, [Drawing.GraphicsUnit]::Pixel, $attr)
  $attr.Dispose(); $g.Dispose(); $src.Dispose()
  $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $out"
}

$svg = Join-Path $web 'icon.svg'
$rounded = Join-Path $tmp 'rounded.png'
Remove-Item $rounded -ErrorAction SilentlyContinue
Render-Master $svg $rounded
Save-Size $rounded 192 (Join-Path $web 'icon-192.png')
Save-Size $rounded 512 (Join-Path $web 'icon-512.png')

# Same artwork without the clip path, for iOS
$squareSvg = Join-Path $tmp 'square.svg'
(Get-Content $svg -Raw) -replace ' clip-path="url\(#tile\)"', '' | Set-Content -Path $squareSvg -Encoding utf8
$square = Join-Path $tmp 'square.png'
Remove-Item $square -ErrorAction SilentlyContinue
Render-Master $squareSvg $square
Save-Size $square 180 (Join-Path $web 'apple-touch-icon.png')
