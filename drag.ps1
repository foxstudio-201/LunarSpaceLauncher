Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Dg {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process XyoLauncher -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { "no-process"; exit 1 }
$r = New-Object Dg+RECT
[Dg]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
[Dg]::SetCursorPos($r.Left + 340, $r.Top + 460) | Out-Null
Start-Sleep -Milliseconds 200
[Dg]::mouse_event(0x2,0,0,0,[UIntPtr]::Zero)
for ($i = 1; $i -le 20; $i++) {
  [Dg]::SetCursorPos($r.Left + 340 + $i * 5, $r.Top + 460) | Out-Null
  Start-Sleep -Milliseconds 25
}
[Dg]::mouse_event(0x4,0,0,0,[UIntPtr]::Zero)
"dragged"
