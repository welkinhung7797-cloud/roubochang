Add-Type -AssemblyName System.Drawing

$outPath = Join-Path $PSScriptRoot 'headbutt_1_pose_guide.png'
$bitmap = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::White)

$floorPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(220, 220, 220), 3)
$graphics.DrawLine($floorPen, 40, 460, 472, 460)

$outline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(45, 28, 15), 9)
$brown = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(133, 75, 24))
$orange = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(239, 110, 13))
$red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(209, 29, 22))
$bluePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(3, 56, 179), 18)
$beltPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(42, 33, 26), 18)

# Feet and weighted rear-foot stance.
$graphics.FillEllipse($orange, 174, 426, 96, 35)
$graphics.DrawEllipse($outline, 174, 426, 96, 35)
$graphics.FillEllipse($orange, 297, 434, 78, 27)
$graphics.DrawEllipse($outline, 297, 434, 78, 27)

# Pelvis remains right of shoulders.
$graphics.FillEllipse($brown, 206, 319, 168, 126)
$graphics.DrawEllipse($outline, 206, 319, 168, 126)

# Backward torso axis: hip center (290,350) to shoulder center (224,225).
$torsoPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(133, 75, 24), 118)
$torsoPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$torsoPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($torsoPen, 290, 354, 224, 225)
$axisPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(45, 28, 15), 8)
$graphics.DrawLine($axisPen, 290, 354, 224, 225)

# Two low rear counterweight wings.
$wingPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(133, 75, 24), 42)
$wingPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$wingPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($wingPen, 226, 245, 108, 319)
$graphics.DrawLine($wingPen, 239, 271, 133, 363)

# Forward-jutted head from the backward shoulders creates the required S-curve.
$neckPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(133, 75, 24), 48)
$neckPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$neckPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($neckPen, 224, 225, 317, 183)
$graphics.FillEllipse($red, 280, 104, 142, 142)
$graphics.DrawEllipse($outline, 280, 104, 142, 142)
$graphics.DrawArc($bluePen, 293, 116, 116, 116, 200, 190)

# Belt follows the backward-loaded pelvis.
$graphics.DrawLine($beltPen, 216, 348, 363, 382)

$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$floorPen.Dispose()
$outline.Dispose()
$brown.Dispose()
$orange.Dispose()
$red.Dispose()
$bluePen.Dispose()
$beltPen.Dispose()
$torsoPen.Dispose()
$axisPen.Dispose()
$wingPen.Dispose()
$neckPen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $outPath
