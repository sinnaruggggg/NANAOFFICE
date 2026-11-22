param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$AppDirectory
)
$ErrorActionPreference = 'Stop'

function Test-ValidSignature([string]$file) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') {
        throw "$([IO.Path]::GetFileName($file)): Authenticode $($signature.Status)"
    }
    $signature.SignerCertificate.Subject
}

$installerPublisher = Test-ValidSignature $Installer
$mainExe = Join-Path $AppDirectory 'NANAOFFICE.exe'
if ((Test-ValidSignature $mainExe) -ne $installerPublisher) {
    throw 'The MSI and NANAOFFICE.exe have different publisher identities.'
}
$libraries = Get-ChildItem -LiteralPath $AppDirectory -Recurse -File |
    Where-Object { $_.FullName -ne $mainExe -and $_.Extension -in '.exe','.dll','.node' }
foreach ($library in $libraries) { $null = Test-ValidSignature $library.FullName }
"Verified MSI and app signatures: $installerPublisher"
