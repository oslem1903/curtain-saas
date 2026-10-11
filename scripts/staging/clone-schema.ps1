# PerdePRO TEST ortamina SEMA aktarimi (yalnizca sema; musteri verisi, Auth kullanicisi ve sir KLONLANMAZ).
# Calistirma (Windows PowerShell, depo kokunde):
#   powershell -ExecutionPolicy Bypass -File scripts\staging\clone-schema.ps1 -StagingRef <yeni-proje-ref>
# Sifreler yalnizca bu terminalde gizli sorulur; dosyaya/loga yazilmaz, process ortamina yalnizca komut suresince verilir.
param(
  [Parameter(Mandatory = $true)][string]$StagingRef,
  [string]$StagingPoolerHost = "",   # Bos birakilirsa Supabase panelindeki "Connection string > Session pooler" ana bilgisayarini sorar
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin"
)
$ErrorActionPreference = "Stop"
$ProdRef = "ffhmzlcsgsgjonqqhgqq"
$ProdPooler = "aws-1-ap-south-1.pooler.supabase.com"   # supabase/.temp/pooler-url ile ayni (parola yok)

if ($StagingRef -eq $ProdRef) { throw "StagingRef uretim projesiyle ayni olamaz." }
if ($StagingRef -notmatch '^[a-z0-9]{20}$') { throw "StagingRef 20 karakterlik proje ref'i olmali." }
foreach ($exe in 'pg_dump.exe','psql.exe') { if (-not (Test-Path (Join-Path $PgBin $exe))) { throw "$exe bulunamadi: $PgBin" } }
if (-not $StagingPoolerHost) { $StagingPoolerHost = Read-Host "Test projesi Session pooler ana bilgisayari (or. aws-0-eu-central-1.pooler.supabase.com)" }

function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$work = Join-Path $env:TEMP ("perdepro-staging-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $work | Out-Null
$dump = Join-Path $work "schema_public.sql"

Write-Host "1/4 Uretimden yalnizca 'public' SEMASI aliniyor (veri yok)..."
$env:PGPASSWORD = Read-Secret "URETIM veritabani sifresi (gizli)"
try {
  & "$PgBin\pg_dump.exe" --schema-only --no-owner --no-privileges --schema=public `
    -h $ProdPooler -p 5432 -U "postgres.$ProdRef" -d postgres -f $dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump basarisiz (cikis $LASTEXITCODE)." }
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }

Write-Host "2/4 Dump dogrulaniyor (veri satiri icermemeli)..."
$dataLines = Select-String -Path $dump -Pattern '^(COPY |INSERT INTO )' | Measure-Object
if ($dataLines.Count -gt 0) { throw "Dump veri satiri iceriyor ($($dataLines.Count)); islem durduruldu." }

Write-Host "3/4 Test projesine uygulaniyor..."
$env:PGPASSWORD = Read-Secret "TEST projesi veritabani sifresi (gizli)"
try {
  $log = Join-Path $work "restore.log"
  & "$PgBin\psql.exe" -h $StagingPoolerHost -p 5432 -U "postgres.$StagingRef" -d postgres -v ON_ERROR_STOP=0 -q -f $dump 2>&1 | Tee-Object -FilePath $log | Out-Null
  $errs = Select-String -Path $log -Pattern 'ERROR' | Where-Object { $_.Line -notmatch 'already exists' }
  Write-Host ("   Uygulama hatasi: " + @($errs).Count + "  (log: $log)")
  Write-Host "4/4 Tohum veri (plan/ayar; musteri verisi degil)..."
  & "$PgBin\psql.exe" -h $StagingPoolerHost -p 5432 -U "postgres.$StagingRef" -d postgres -v ON_ERROR_STOP=1 -q -f (Join-Path $PSScriptRoot "seed-staging.sql")
  if ($LASTEXITCODE -ne 0) { throw "Tohum veri uygulanamadi." }
  Write-Host "Tamam. Kalan adimlar: scripts\staging\README.md"
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
