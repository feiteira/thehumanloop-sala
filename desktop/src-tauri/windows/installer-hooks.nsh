; "Sala (example)" in the Start menu: the same program with --example, which opens a
; fictional practice that resets at every start. Named in the language chosen for the install.

Var SalaExampleLnk

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $SalaExampleLnk "Sala (example)"
  ${If} $LANGUAGE == 2070
    StrCpy $SalaExampleLnk "Sala (exemplo)"
  ${ElseIf} $LANGUAGE == 1034
    StrCpy $SalaExampleLnk "Sala (ejemplo)"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\$SalaExampleLnk.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--example"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Sala (example).lnk"
  Delete "$SMPROGRAMS\Sala (exemplo).lnk"
  Delete "$SMPROGRAMS\Sala (ejemplo).lnk"
!macroend
