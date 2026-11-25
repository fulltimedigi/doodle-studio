# Director V3: public product benchmark and architectural direction (2026-11-25)

Scope: public documentation and product behavior descriptions, not private source access, proprietary code extraction, or paid hands-on trials. Original implementation remains isolated on feature branch.

| Product | Public reference | Engineering lesson |
|---|---|---|
| Adobe After Effects | https://helpx.adobe.com/ie/after-effects/desktop/animate-in-after-effects/animation-basics/animation-basics.html | Property-specific keyframes and graph/easing controls |
| Jitter | https://help.jitter.video/en/articles/16414495-design-and-animate-modes ; https://help.jitter.video/en/articles/14111802-work-with-the-timeline | Separate persistent design from timed operations; independent layer timing |
| Vyond | https://www.vyond.com/faqs/ ; https://help.vyond.com/hc/en-us/articles/17222013592468-Motion-Path | Character actions, camera paths, lip sync; don't confuse moving a flat picture with character animation |
| Runway | https://runway.com/resources/ai-camera-control | Scene direction and reference continuity; not a substitute for editorial control |
| Lottie Creator | https://docs.lottiefiles.com/en/creator/01_introduction/key-features | Vector layers, keyframes, curve controls |
| Rive | https://rive.app/features | Reusable animated artboards and states |
| Remotion | https://www.remotion.dev/docs/transitions/transitionseries ; https://www.remotion.dev/docs/license/pricing | Frame-based rendering and transitions; license conditions must be reviewed before adoption |
| Motion Canvas | https://github.com/motion-canvas/motion-canvas | MIT-licensed code-first motion engine; candidate for a future isolated proof of concept |

## Decisions
- Do not rewrite existing Doodle/Reel Pro or add a large dependency now.
- Start with a deterministic motion-layer primitive and explicit timing presets; same math in preview and export. Preserve existing JSON, enforce stable text at end of entrance.
- Keep procedural drawings as fallback only. Dedicated scene art and real product screen recordings are the path to higher visual quality. Avoid treating invented UI or metrics as evidence.
- Next milestones: independent reusable vector/character assets (with licenses tracked), multi-asset scene graph and GUI editing, visual storyboard quality gate, exact frame-by-frame encoder and mixed-audio verification; test import/export portability and actual Arabic typography. Evaluate Motion Canvas in a sandbox before any dependency decision.
- No external service calls, no new libraries, no production change in this slice.

## Slice 6 implementation
Three independently editable tracks (visual, title, subtitle), validated keyframes with normalized offsets and scale, five easing options, calm/editorial/static presets, scene fade or cut, track display and playhead. Existing scenes receive compatible defaults. Reading-budget logic accounts for last movement and rejects an invisible/displaced final state. This is an incremental primitive, NOT a full multi-object editor, curve GUI, character rig, or frame-accurate encoder. Browser/full-suite validation remains outstanding.


## Slice 7 — original multi-object scene composer
Opt-in scene graph persists in JSON. Up to 24 objects with unique IDs, normalized artboard bounds, independent entrance timing, order and pose. Thirteen original vector primitives, three themes, six story-role presets and an editable campaign example. Merchant/shopper use articulated arm segments for illustrative gestures (not lip sync or a full skeleton editor). Each entrance is sampled from absolute time. Reading estimates include graph text and latest entrance. Captions reserve dedicated space and flag overflow. Real app proof requires real media; attached media takes precedence over graph. Existing scenes remain compatible. Structured numeric controls, not yet drag-and-drop. No proprietary assets or new dependencies. Actual browser UI and visual review pending.

## Slice 8 — visual editing and deterministic local rendering
Added an independent visual artboard for direct pointer dragging and corner resizing, normalized bounds, optional grid snapping, z-order hit testing and one-step drag undo (valid only while the same scene revision is current). Pointer editing is local; no API calls. Added scripts/render-director.mjs using the project's existing Playwright and FFmpeg dependencies. It samples the actual Director renderer at k/fps, streams PNG frames to H.264, optional local WAV to AAC, pads/trims audio to the frame duration, uses bundled Cairo and brand logo, and refuses media/evidence layouts rather than fabricating screenshots. 720/1080, 24/25/30/60 fps. Example: node scripts/render-director.mjs director-project.json output/film.mp4 --fps 30 --size 720 --audio director-audio.wav. JSON does not contain browser attachments; use this route only for vector/procedural scenes. Browser export remains unchanged for attached assets. No new dependencies or external service calls. The new CLI and pointer integration require real local browser verification before release; unit tests cover coordinate transforms and frame scheduling, not encoding quality.
