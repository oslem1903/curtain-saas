; PerdePRO NSIS ozellestirme: uygulama aciksa kurulum/guncelleme TAKILMAZ.
; Once nazik kapatma, sonra zorla kapatma denenir. Kullanici verisi (userData) ve oturum SILINMEZ;
; yalnizca calisan PerdePRO.exe sureci sonlandirilir.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Sleep 1000
!macroend

; Eski surumun kaldiricisi "--updated" kipinde hata kodu dondururse (ornegin 1.0.16 -> exit 2) kurulum
; ARTIK iptal edilmez: yeni dosyalar mevcut kurulumun uzerine yazilir. Kullanici verisi (userData) silinmez.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Eski surum kaldirici kodu $R0 dondurdu; guncelleme dosyalarin uzerine yazilarak surdurulur."
  ${endif}
!macroend
!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint "Eski surum kaldirici kodu $R0 dondurdu; guncelleme dosyalarin uzerine yazilarak surdurulur."
  ${endif}
!macroend
