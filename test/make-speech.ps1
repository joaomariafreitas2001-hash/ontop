# Generates test/speech.wav: the fixture script read by the built-in Windows voice
# (16 kHz mono), used by `npm run test:track` and test/vosk-test.html.
#   powershell -File test/make-speech.ps1

Add-Type -AssemblyName System.Speech
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$text = (Get-Content (Join-Path $here 'fixture-script.txt') -Raw) -replace '\[[^\]]*\]', ' '
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile((Join-Path $here 'speech.wav'), $format)
$synth.Speak($text)
$synth.Dispose()
Write-Output "Wrote test/speech.wav"
