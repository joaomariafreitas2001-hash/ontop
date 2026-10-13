# Generates the test recordings, read by the built-in Windows voice (16 kHz mono):
#   test/speech.wav       the fixture script, read cleanly
#   test/speech-hard.wav  the same talk with a mispronounced phrase and an off-script aside
# Used by `npm run test:track`, `npm run demo` and test/vosk-test.html.
#   powershell -File test/make-speech.ps1

Add-Type -AssemblyName System.Speech
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)

function Write-Speech($file, $text) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SetOutputToWaveFile((Join-Path $here $file), $format)
  $synth.Speak($text)
  $synth.Dispose()
  Write-Output "Wrote test/$file"
}

$script = (Get-Content (Join-Path $here 'fixture-script.txt') -Raw) -replace '\[[^\]]*\]', ' '
Write-Speech 'speech.wav' $script

$hard = @'
Good morning, everyone. Thank you for joining this quarterly review. Today I will walk you through our results, the projects we delivered, and the plan for next year.
Sorry, give me one second, I need to share my screen. Can you all see it now? Great.
Revenue grew by 12% comprahd wiz lusht yeer, while costs stayed flat. Our customer base reached 4,500 companies across Europe and Asia.
Next year we will focus on three priorities: faster onboarding, better support, and a new mobile app.
'@
Write-Speech 'speech-hard.wav' $hard

# Voice setup test: the three English setup sentences and the tricky words of
# test/setup-script.txt, one file each.
$sentences = @(
  'The quick brown fox jumps over the lazy dog near the river bank.',
  'Please call Stella and ask her to bring these things with her from the store.',
  'Our results this quarter were stronger than we expected in every region.'
)
for ($i = 0; $i -lt 3; $i++) { Write-Speech "setup-s$i.wav" $sentences[$i] }
foreach ($w in 'EMIR','Northwind','Bank','Lisbon') { Write-Speech "setup-w-$w.wav" $w }
