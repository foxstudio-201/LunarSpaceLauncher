Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mv {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
}
"@
$p = Get-Process java -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { [Mv]::MoveWindow($p.MainWindowHandle, 0, 0, 640, 400, $true) | Out-Null; "moved $($p.Id)" } else { "none" }
