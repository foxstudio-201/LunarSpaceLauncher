param([string]$out = "C:\phanmem\shot.png", [int]$x = -1, [int]$y = -1, [int]$wx = -1, [int]$wy = -1, [int]$sleep = 0)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process XyoLauncher -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no-process"; exit 1 }
$h = $p.MainWindowHandle
[W2]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 150
if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
$r = New-Object W2+RECT
[W2]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
if ($x -ge 0 -and $y -ge 0) {
  $px = $r.Left + $x
  $py = $r.Top + $y
  if ($wx -gt 0) { $px = $r.Left + $x; $py = $r.Top + $y }
  [W2]::SetCursorPos($px, $py) | Out-Null
  Start-Sleep -Milliseconds 200
  [W2]::mouse_event(0x2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [W2]::mouse_event(0x4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 700
}
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "rect $($r.Left),$($r.Top) ${w}x${hh} -> $out"
