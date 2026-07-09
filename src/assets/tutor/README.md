# EMBER's voice clips

One mp3 per line, named `<line-id>.mp3` — the ids live in
`src/tutorial/script.ts` and the full recording script (read direction,
triggers, delivery spec) is `docs/tutorial-ember.md`.

Drop the transcoded clips straight into this directory; `src/audio/tutorVoice.ts`
globs `*.mp3` here and decodes them at tutorial start. Any line without a clip
plays silently with its caption — the tutorial is fully playable before a
single clip lands, so ship them as they're recorded.

Source recordings should be 48 kHz mono WAV, dry (no reverb — spatialisation
happens in-engine); transcode to mp3 for this directory.
