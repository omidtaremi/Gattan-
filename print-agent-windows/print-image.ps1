param(
  [string]$PrinterName = "auto",
  [Parameter(Mandatory=$true)][string]$ImagePath,
  [int]$PaperWidthMm = 72,
  [int]$Copies = 1
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Printing

if (-not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image file not found: $ImagePath"
}

# Resolve target Windows printer (auto-detect Sewoo 100 if set to 'auto')
$resolvedPrinter = $PrinterName
if ([string]::IsNullOrWhiteSpace($resolvedPrinter) -or $resolvedPrinter.ToLower() -eq "auto") {
  $installed = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
  $sewooMatch = $null
  foreach ($p in $installed) {
    if ($p -match "sewoo|lk-?p?100|slk|pos-?80|thermal") {
      $sewooMatch = $p
      break
    }
  }
  if ($sewooMatch) {
    $resolvedPrinter = $sewooMatch
  } else {
    $defaultSettings = New-Object System.Drawing.Printing.PrinterSettings
    $resolvedPrinter = $defaultSettings.PrinterName
  }
}

$sourceBmp = [System.Drawing.Bitmap]::FromFile($ImagePath)
$croppedBmp = $null

try {
  $w = $sourceBmp.Width
  $h = $sourceBmp.Height

  # Trim trailing pure-white space at the bottom so paper length matches exact content height
  $lastNonWhiteY = 20
  for ($y = $h - 1; $y -ge 0; $y -= 2) {
    $rowHasInk = $false
    for ($x = 0; $x -lt $w; $x += 3) {
      $px = $sourceBmp.GetPixel($x, $y)
      if ($px.R -lt 245 -or $px.G -lt 245 -or $px.B -lt 245) {
        $rowHasInk = $true
        break
      }
    }
    if ($rowHasInk) {
      $lastNonWhiteY = $y
      break
    }
  }

  # Add ~32px (~4mm) bottom breathing space before Sewoo auto-cut
  $cropHeight = [Math]::Min($h, $lastNonWhiteY + 32)
  if ($cropHeight -lt 80) { $cropHeight = [Math]::Min($h, 120) }

  $cropRect = New-Object System.Drawing.Rectangle(0, 0, $w, $cropHeight)
  $croppedBmp = $sourceBmp.Clone($cropRect, $sourceBmp.PixelFormat)

  # Convert mm to hundredths of an inch (100 units = 25.4mm)
  $paperWidthUnits = [int][Math]::Round(($PaperWidthMm / 25.4) * 100)
  $aspectRatio = [double]$cropHeight / [double]$w
  $drawHeightUnits = [int][Math]::Ceiling($paperWidthUnits * $aspectRatio)
  $paperHeightUnits = $drawHeightUnits + 12

  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = "Gatan Receipt"
  $doc.PrinterSettings.PrinterName = $resolvedPrinter
  if (-not $doc.PrinterSettings.IsValid) {
    throw "Printer '$resolvedPrinter' is not valid or not installed on this Windows machine."
  }
  $doc.PrinterSettings.Copies = [int16][Math]::Min(5, [Math]::Max(1, $Copies))
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

  $customPaper = New-Object System.Drawing.Printing.PaperSize("GatanReceipt", $paperWidthUnits, $paperHeightUnits)
  $doc.DefaultPageSettings.PaperSize = $customPaper
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false

  $bmpRef = $croppedBmp
  $targetW = $paperWidthUnits
  $targetH = $drawHeightUnits

  $doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $targetW, $targetH)
    $e.Graphics.DrawImage($bmpRef, $destRect)
    $e.HasMorePages = $false
  })

  $doc.Print()
  Write-Output "Printed successfully to '$resolvedPrinter' (${PaperWidthMm}mm x $([Math]::Round($paperHeightUnits * 0.254, 1))mm)"
}
finally {
  if ($croppedBmp) { $croppedBmp.Dispose() }
  if ($sourceBmp) { $sourceBmp.Dispose() }
}
