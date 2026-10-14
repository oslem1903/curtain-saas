; PerdePRO NSIS ozellestirme: uygulama aciksa kurulum/guncelleme TAKILMAZ.
; Once nazik kapatma, sonra zorla kapatma denenir. Kullanici verisi (userData) ve oturum SILINMEZ;
; yalnizca calisan PerdePRO.exe sureci sonlandirilir.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Sleep 1000
!macroend
