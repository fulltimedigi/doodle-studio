# Director V3 — experimental slice

Independent local-only editor; existing Doodle and Reel Pro remain untouched. Six distinct schematic compositions, editable timeline, local image/video per scene, Arabic text fitting, 1080 portrait/landscape, PNG and real-time video export (browser-dependent MP4 or WebM). The same renderer drives preview and recording. The sample uses no fabricated sales metrics. No synthetic pen noise, provider calls or remote media.

Limitations: artwork is procedural and schematic, not AI-generated; user supplies bespoke images, screen recordings and a single narration audio track. No automatic TTS, music, beat alignment or creative AI director yet. JSON saves text/timing only. Quality checks are heuristic; duplicate assets use filename/size/mtime. Export requires a visible supported browser and real codec/A-V verification. Max 30 scenes, 600 seconds.

Before release: run node --test test/director-v3.test.mjs, npm test, npm run build:site locally; manually test Arabic layout, both aspect ratios, video attachments and export playback. No cloud CI or provider spend without approval.