Add-Type -AssemblyName System.Drawing

$rawDir = Join-Path $PSScriptRoot 'action_raw'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$outDir = Join-Path $projectRoot 'action_frames'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$targetBottoms = @{
    'headbutt_1' = 460
    'headbutt_2' = 460
    'bigboot_1' = 460
    'bigboot_2' = 460
    'elbow_1' = 430
    'elbow_2' = 460
    'slam_1' = 440
    'slam_2' = 460
    'punch_3' = 460
}

function Get-SubjectBounds {
    param([System.Drawing.Bitmap]$Bitmap)

    $minX = $Bitmap.Width
    $minY = $Bitmap.Height
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            $c = $Bitmap.GetPixel($x, $y)
            if (($c.R -lt 248) -or ($c.G -lt 248) -or ($c.B -lt 248)) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }

    if ($maxX -lt $minX -or $maxY -lt $minY) {
        throw 'No non-white subject pixels found.'
    }

    return [System.Drawing.Rectangle]::new(
        $minX,
        $minY,
        $maxX - $minX + 1,
        $maxY - $minY + 1
    )
}

Get-ChildItem -LiteralPath $rawDir -Filter '*_raw.png' | Sort-Object Name | ForEach-Object {
    $frameName = $_.BaseName -replace '_raw$', ''
    if (-not $targetBottoms.ContainsKey($frameName)) {
        throw "Missing baseline configuration for $frameName"
    }

    $source = [System.Drawing.Bitmap]::new($_.FullName)
    $bounds = Get-SubjectBounds -Bitmap $source
    $baseScale = 512.0 / [double]$source.Width

    if ($frameName -eq 'slam_2') {
        # Explicitly enforce the requested idle-relative squash dimensions:
        # approximately 125% of the canonical 392 px width and 75% of its 416 px height.
        $destWidth = 490
        $destHeight = 312
        $destX = 11
    }
    else {
        $destWidth = [int][Math]::Round($bounds.Width * $baseScale)
        $destHeight = [int][Math]::Round($bounds.Height * $baseScale)
        $destX = [int][Math]::Round($bounds.X * $baseScale)

        if (($destX + $destWidth) -gt 504) {
            $destX = 504 - $destWidth
        }
        if ($destX -lt 8) { $destX = 8 }
    }

    $destY = [int]$targetBottoms[$frameName] - $destHeight + 1
    if ($destY -lt 8) { $destY = 8 }

    $canvas = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $destination = [System.Drawing.Rectangle]::new($destX, $destY, $destWidth, $destHeight)
    $graphics.DrawImage($source, $destination, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    $source.Dispose()

    # Collapse the generator's near-white backdrop to exact opaque #FFFFFF.
    for ($y = 0; $y -lt $canvas.Height; $y++) {
        for ($x = 0; $x -lt $canvas.Width; $x++) {
            $c = $canvas.GetPixel($x, $y)
            $maxChannel = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
            $minChannel = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
            $nearWhite = ($c.R -ge 248) -and ($c.G -ge 248) -and ($c.B -ge 248)
            $neutralResizeSeam = ($minChannel -ge 225) -and (($maxChannel - $minChannel) -le 4)
            if ($nearWhite -or $neutralResizeSeam) {
                $canvas.SetPixel($x, $y, [System.Drawing.Color]::White)
            }
        }
    }

    $outPath = Join-Path $outDir ($frameName + '.png')
    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()

    [pscustomobject]@{
        Frame = $frameName
        Output = $outPath
        SourceBounds = "{0},{1} {2}x{3}" -f $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height
        DestBounds = "{0},{1} {2}x{3}" -f $destX, $destY, $destWidth, $destHeight
        Baseline = $targetBottoms[$frameName]
    }
}
