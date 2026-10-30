# Cree le fichier .env (secret JWT + mot de passe admin aleatoires) au premier demarrage.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret([int]$n) {
  $bytes = New-Object byte[] $n
  $rng.GetBytes($bytes)
  $out = ''
  foreach ($b in $bytes) { $out += $chars[$b % $chars.Length] }
  return $out
}
$adminPass = New-Secret 14
$jwt = New-Secret 48
$lines = @("JWT_SECRET=$jwt", 'ADMIN_EMAIL=admin@flotte.local', "ADMIN_PASSWORD=$adminPass")
Set-Content -Path $envFile -Value $lines -Encoding ascii
Write-Host ''
Write-Host '  Identifiant  : admin@flotte.local'
Write-Host "  Mot de passe : $adminPass"
Write-Host '  (conserve dans le fichier .env - a changer dans Utilisateurs apres connexion)'
Write-Host ''
