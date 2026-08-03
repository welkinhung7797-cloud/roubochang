param(
    [string]$InputDir = (Join-Path $PSScriptRoot '.'),
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\kenshi_combo')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public sealed class FrameMetrics
{
    public string Name;
    public int Width;
    public int Height;
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
    public int OrangeBottom;
    public int AlphaMin;
    public int AlphaMax;
    public string CornerColor;
    public long NonWhitePixels;
}

public static class KenshiFrameProcessor
{
    private static readonly Color[] Palette = new Color[] {
        Color.FromArgb(255, 255, 255),
        Color.FromArgb(250, 248, 242),
        Color.FromArgb(232, 232, 234),
        Color.FromArgb(214, 215, 220),
        Color.FromArgb(27, 33, 51),
        Color.FromArgb(35, 42, 64),
        Color.FromArgb(48, 57, 86),
        Color.FromArgb(58, 72, 116),
        Color.FromArgb(17, 21, 34),
        Color.FromArgb(22, 30, 54),
        Color.FromArgb(34, 47, 84),
        Color.FromArgb(49, 65, 111),
        Color.FromArgb(15, 12, 15),
        Color.FromArgb(255, 148, 28),
        Color.FromArgb(255, 178, 48),
        Color.FromArgb(226, 98, 8),
        Color.FromArgb(238, 240, 244),
        Color.FromArgb(170, 180, 195),
        Color.FromArgb(105, 116, 135),
        Color.FromArgb(112, 81, 48),
        Color.FromArgb(170, 127, 67),
        Color.FromArgb(218, 160, 42),
        Color.FromArgb(7, 9, 15)
    };

    public static FrameMetrics Process(string inputPath, string outputPath, bool airborne)
    {
        using (Bitmap opened = new Bitmap(inputPath))
        using (Bitmap src = new Bitmap(opened.Width, opened.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(src))
            {
                g.Clear(Color.White);
                g.DrawImageUnscaled(opened, 0, 0);
            }

            int orangeBottom = CleanAndQuantize(src);
            const int canvas = 512;
            const int baseScaled = 480;
            string fileName = Path.GetFileName(outputPath);
            double widthMultiplier = 1.0;
            double heightMultiplier = 1.0;
            if (String.Equals(fileName, "yokoichi_1.png", StringComparison.OrdinalIgnoreCase)) widthMultiplier = heightMultiplier = 0.88;
            if (String.Equals(fileName, "kiriotoshi_2.png", StringComparison.OrdinalIgnoreCase)) { widthMultiplier = 0.82; heightMultiplier = 0.808; }
            if (String.Equals(fileName, "issen_1.png", StringComparison.OrdinalIgnoreCase)) widthMultiplier = heightMultiplier = 0.88;
            if (String.Equals(fileName, "karatake_2.png", StringComparison.OrdinalIgnoreCase)) widthMultiplier = heightMultiplier = 0.80;
            int scaledWidth = (int)Math.Round(baseScaled * widthMultiplier);
            int scaledHeight = (int)Math.Round(baseScaled * heightMultiplier);
            double scale = (double)scaledHeight / src.Height;
            int targetFoot = airborne ? 420 : 478;
            int y = targetFoot - (int)Math.Round(orangeBottom * scale);
            int x = (canvas - scaledWidth) / 2;

            using (Bitmap dest = new Bitmap(canvas, canvas, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(dest))
                {
                    g.Clear(Color.White);
                    g.CompositingMode = CompositingMode.SourceOver;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.DrawImage(src, new Rectangle(x, y, scaledWidth, scaledHeight), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel);
                }

                ForceOpaqueWhiteCorners(dest);
                Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
                dest.Save(outputPath, ImageFormat.Png);
                return Measure(dest, Path.GetFileName(outputPath));
            }
        }
    }

    private static int CleanAndQuantize(Bitmap bmp)
    {
        int w = bmp.Width;
        int h = bmp.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            byte[] px = new byte[stride * h];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            int total = w * h;
            bool[] candidate = new bool[total];
            bool[] background = new bool[total];
            int[] queue = new int[total];

            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                int flat = y * w;
                for (int x = 0; x < w; x++)
                {
                    int p = row + x * 4;
                    int b = px[p];
                    int g = px[p + 1];
                    int r = px[p + 2];
                    int min = Math.Min(r, Math.Min(g, b));
                    int max = Math.Max(r, Math.Max(g, b));
                    candidate[flat + x] = min >= 224 && (max - min) <= 24;
                }
            }

            int head = 0, tail = 0;
            Action<int> enqueue = delegate(int id) {
                if (candidate[id] && !background[id]) {
                    background[id] = true;
                    queue[tail++] = id;
                }
            };
            for (int x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
            for (int y = 1; y < h - 1; y++) { enqueue(y * w); enqueue(y * w + (w - 1)); }

            while (head < tail)
            {
                int id = queue[head++];
                int x = id % w;
                int y = id / w;
                if (x > 0) enqueue(id - 1);
                if (x + 1 < w) enqueue(id + 1);
                if (y > 0) enqueue(id - w);
                if (y + 1 < h) enqueue(id + w);
            }

            int orangeBottom = -1;
            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                int flat = y * w;
                for (int x = 0; x < w; x++)
                {
                    int p = row + x * 4;
                    int id = flat + x;
                    if (background[id])
                    {
                        px[p] = 255; px[p + 1] = 255; px[p + 2] = 255; px[p + 3] = 255;
                        continue;
                    }

                    int b = px[p];
                    int g = px[p + 1];
                    int r = px[p + 2];
                    if (r > 190 && g >= 55 && g < 205 && b < 105 && r > g + 45)
                        orangeBottom = Math.Max(orangeBottom, y);

                    Color nearest = Palette[0];
                    int best = Int32.MaxValue;
                    foreach (Color c in Palette)
                    {
                        int dr = r - c.R;
                        int dg = g - c.G;
                        int db = b - c.B;
                        int score = dr * dr * 3 + dg * dg * 4 + db * db * 2;
                        if (score < best) { best = score; nearest = c; }
                    }
                    px[p] = nearest.B;
                    px[p + 1] = nearest.G;
                    px[p + 2] = nearest.R;
                    px[p + 3] = 255;
                }
            }

            if (orangeBottom < 0) orangeBottom = h - 1;
            Marshal.Copy(px, 0, data.Scan0, px.Length);
            return orangeBottom;
        }
        finally
        {
            bmp.UnlockBits(data);
        }
    }

    private static void ForceOpaqueWhiteCorners(Bitmap bmp)
    {
        int w = bmp.Width, h = bmp.Height;
        bmp.SetPixel(0, 0, Color.White);
        bmp.SetPixel(w - 1, 0, Color.White);
        bmp.SetPixel(0, h - 1, Color.White);
        bmp.SetPixel(w - 1, h - 1, Color.White);
    }

    public static FrameMetrics Measure(Bitmap bmp, string name)
    {
        int left = bmp.Width, top = bmp.Height, right = -1, bottom = -1;
        int orangeBottom = -1, alphaMin = 255, alphaMax = 0;
        long nonWhite = 0;
        for (int y = 0; y < bmp.Height; y++)
        {
            for (int x = 0; x < bmp.Width; x++)
            {
                Color c = bmp.GetPixel(x, y);
                alphaMin = Math.Min(alphaMin, c.A);
                alphaMax = Math.Max(alphaMax, c.A);
                bool white = c.R >= 253 && c.G >= 253 && c.B >= 253;
                if (!white)
                {
                    nonWhite++;
                    left = Math.Min(left, x); top = Math.Min(top, y);
                    right = Math.Max(right, x); bottom = Math.Max(bottom, y);
                }
                if (c.R > 190 && c.G >= 55 && c.G < 205 && c.B < 105 && c.R > c.G + 45)
                    orangeBottom = Math.Max(orangeBottom, y);
            }
        }
        Color corner = bmp.GetPixel(0, 0);
        return new FrameMetrics {
            Name = name, Width = bmp.Width, Height = bmp.Height,
            Left = left, Top = top, Right = right, Bottom = bottom,
            OrangeBottom = orangeBottom, AlphaMin = alphaMin, AlphaMax = alphaMax,
            CornerColor = String.Format("#{0:X2}{1:X2}{2:X2}", corner.R, corner.G, corner.B),
            NonWhitePixels = nonWhite
        };
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$frames = @(
    @{ Name = 'yokoichi_1.png'; Airborne = $false },
    @{ Name = 'yokoichi_2.png'; Airborne = $false },
    @{ Name = 'kiriotoshi_1.png'; Airborne = $false },
    @{ Name = 'kiriotoshi_2.png'; Airborne = $false },
    @{ Name = 'issen_1.png'; Airborne = $false },
    @{ Name = 'issen_2.png'; Airborne = $false },
    @{ Name = 'karatake_1.png'; Airborne = $true },
    @{ Name = 'karatake_2.png'; Airborne = $false }
)

$metrics = foreach ($frame in $frames) {
    $inputPath = Join-Path $InputDir $frame.Name
    $outputPath = Join-Path $OutputDir $frame.Name
    [KenshiFrameProcessor]::Process($inputPath, $outputPath, [bool]$frame.Airborne)
}

$metrics | ConvertTo-Json -Depth 3
