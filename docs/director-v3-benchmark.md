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
