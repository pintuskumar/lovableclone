param(
  [Parameter(Mandatory = $true)]
  [string]$PreviewHost,
  [string]$Token
)

function Get-PreviewIps {
  param([string]$HostName)

  $resp = Invoke-WebRequest -Headers @{ accept = "application/dns-json" } `
    -Uri "https://cloudflare-dns.com/dns-query?name=$HostName&type=A" `
    -UseBasicParsing

  $jsonText = [System.Text.Encoding]::UTF8.GetString($resp.Content)
  $json = $jsonText | ConvertFrom-Json
  $ips = @($json.Answer | Where-Object { $_.type -eq 1 } | Select-Object -ExpandProperty data -Unique)

  if ($ips.Count -eq 0) {
    throw "No A records found for $HostName"
  }

  return $ips
}

try {
  $ips = Get-PreviewIps -HostName $PreviewHost
  $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"

  $lines = Get-Content $hostsPath -Raw -Encoding ascii
  $filtered = $lines -split "`r?`n" | Where-Object { $_ -notmatch "\s+$([regex]::Escape($PreviewHost))(\s|$)" }

  $filtered += ""
  $filtered += "# Daytona preview override"
  foreach ($ip in $ips) {
    $filtered += "$ip $PreviewHost"
  }

  Set-Content -Path $hostsPath -Value ($filtered -join "`r`n") -Encoding ascii
  ipconfig /flushdns | Out-Null

  Write-Host "Hosts updated for $PreviewHost: $($ips -join ', ')"
  if ($Token) {
    $firstIp = $ips[0]
    Write-Host "Test with curl.exe:"
    Write-Host "curl.exe --resolve `"$PreviewHost:443:$firstIp`" -H `"x-daytona-preview-token: $Token`" -I `"https://$PreviewHost`""
  }
} catch {
  Write-Error $_.Exception.Message
  Write-Error "Run this script from an elevated PowerShell session (Run as Administrator)."
  exit 1
}
