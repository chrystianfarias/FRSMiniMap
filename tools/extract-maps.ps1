<#
    Puts the redrawn TRACKMAPs of "NFSU2 Detailed Map" (JeansBig) in maps\.

    The maps are not in this repository: they are somebody else's work and
    461 MB. Download the pack, then point this at the zip:

        .\tools\extract-maps.ps1 -Zip "C:\Users\<you>\Downloads\2d7d87-NFSU2 Detailed Map v1 Reup.zip"

    It takes the Default variant of every map, and the pack's root for the ones
    that have no variants (drift 43xx, Street X 46xx), unchanged. Nothing is
    installed into the game: the mod reads them from its own folder.
    maps\calibration.json is ours and is in the repository.
#>
param(
    [Parameter(Mandatory = $true)] [string]$Zip,
    [string]$Out = (Join-Path $PSScriptRoot "..\maps")
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path $Zip)) { throw "zip not found: $Zip" }
New-Item -ItemType Directory -Force $Out | Out-Null

$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Zip))
try {
    $pick = @{}
    foreach ($e in $archive.Entries) {
        if ($e.FullName -notmatch '\.dds$') { continue }
        $parts = $e.FullName -split '/'
        if ($parts -contains 'Beta') { continue }
        $name = $parts[-1]
        if ($parts -contains 'Default' -or -not $pick.ContainsKey($name)) { $pick[$name] = $e }
    }
    foreach ($name in $pick.Keys) {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($pick[$name], (Join-Path $Out $name), $true)
    }
    $readme = $archive.Entries | Where-Object { $_.FullName -eq 'readme.txt' } | Select-Object -First 1
    $credit = "The TRACKMAP*.dds files in this folder come from `"NFSU2 Detailed Map v1`" by JeansBig, " +
              "unchanged: the Default variant of each map, and the pack's root for the ones with no " +
              "variants (drift 43xx, Street X 46xx).`r`n`r`nOriginal readme:`r`n`r`n"
    if ($readme) {
        $reader = New-Object System.IO.StreamReader($readme.Open())
        $credit += $reader.ReadToEnd(); $reader.Close()
    }
    Set-Content -Path (Join-Path $Out "README-DetailedMap.txt") -Value $credit -Encoding UTF8
    "[ok] $($pick.Count) maps in $Out"
}
finally { $archive.Dispose() }
