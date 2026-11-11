# The hearing check's voices: one WAV per line of a TSV (id <tab> voice <tab> words), 48 kHz 16-bit mono, with
# silence before and after so the recognizer hears a start and an end. Uses whatever System.Speech voices are
# installed; on the machine of the 2.13.2 check that was only Microsoft David and Zira (en-US): no en-IN or hi-IN.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tts.ps1 -List phrases.tsv -OutDir <folder>
param([string]$List, [string]$OutDir)
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($line in Get-Content -Encoding UTF8 $List) {
  if (-not $line.Trim()) { continue }
  $parts = $line.Split("`t")
  $id = $parts[0]; $voice = $parts[1]; $text = $parts[2]
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voice)
  $path = Join-Path $OutDir "$id.wav"
  $s.SetOutputToWaveFile($path, $fmt)
  $esc = [System.Security.SecurityElement]::Escape($text)
  $s.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><break time='700ms'/>$esc<break time='2500ms'/></speak>")
  $s.SetOutputToNull()
  $s.Dispose()
  Write-Output "$id ok"
}
