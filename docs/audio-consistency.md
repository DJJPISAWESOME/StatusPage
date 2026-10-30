# Kiosk audio consistency

Radio and YouTube share one authoritative Board/remote volume and mute. At master 40%, settled radio volume is 0.4 and YouTube receives 40/100 when Auto level is off and no alert is audible. The separate YouTube relative-volume setting and multiplier are removed. Old `signal:youtubeTrim` values are ignored, including after reload; they cannot keep requests quiet.

Every request receives volume zero before `loadVideoById`, then ramps over 1.1 seconds after its matching PLAYING event. Pause/buffering holds an unfinished incoming ramp; resume continues it. Outgoing handoffs finish even if the old video pauses or buffers. Radio starts/reconnects at zero and ramps after the media element's playing event. Stale radio connect/playing callbacks cannot cancel a request handoff. Master volume/mute changes remain authoritative throughout. Remote changes update the same saved master preference. Queue, lease, network filters, and station behavior are unchanged.

## Playback volume restoration

Matching YouTube PLAYING events now reapply the composed Board output even after the incoming ramp has completed. Previously, a player volume changed to 9 after settling at master 40 remained at 9 through buffering/resume. The browser regression test injects that divergence and verifies restoration to 40, including zero master mute and active alert/level gains. This demonstrates a controller gap; it does not establish that the kiosk experienced that exact sequence.

YouTube also has an independent mute flag: `setVolume` alone does not clear it. New requests clear inherited iframe mute after setting output to zero, and explicit positive Board/remote volume commands clear it after applying the requested output. Native mute during a request is otherwise left alone until a new request or explicit volume command. Browser autoplay permission remains required. Late state/error callbacks during outgoing handoffs or radio fallback are ignored, and replaced-video state events cannot interrupt the current ramp.

The deployed public `audio-fades.js` matched the main-branch version during this investigation on October 30, 2026. No production queue, volume, or playback was changed. This correction retains one master volume and does not introduce a relative trim or enable tab capture.

## Alert ducking

Alert gain is separate from master volume and fades. It applies only while the tone AudioContext is running or a speech utterance emits its [start event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/start_event). Tones release the duck before speech is queued; a blocked or delayed utterance does not lower playback while waiting. End/error, cancellation, Board exit, and the speech watchdog release it. Late start events from a cancelled or expired utterance cannot reapply it.

The quiet-output investigation reproduced PR #169 ducking YouTube before any audible alert: master 100% with the former default trim commanded 50 normally but 13 while speech was queued and never started. This fix removes that lifecycle error as well as the explicitly unwanted trim. The kiosk's exact acoustic cause was not established from live telemetry; its API supplied no current request at inspection time. Justin confirmed Auto level is not used. No live queue, playback, or volume was changed during investigation.

## Limits and optional capture

Equal API control values are not equivalent loudness measurements. Recordings, broadcaster processing, ads, the TV, and YouTube's own mute/volume behavior can differ. The [official YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference#Playback_controls) exposes volume controls but not PCM samples or loudness metadata. Host-side fades cannot guarantee sample-level limiting or acoustic matching.

Optional **Auto level audio** remains off until explicitly enabled through Chrome's user-authorized capture of this verified Board tab. It reactively attenuates YouTube and can recover up to the master level; it does not level radio. Capture permission must be renewed after reload. The capture graph connects only to an analyser, never the destination. Silence, pauses, transitions, notices, and speech suspend adaptation. This request makes no changes to its capture permissions or feedback algorithm.

Arbitrary broadcaster streams cannot safely be routed through Web Audio without suitable [cross-origin permission](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceNode-security). Direct radio playback is preserved; no media proxy, download, or extraction is added.

## Verification

Run `npm test`, `npm run build`, and `SIGNAL_START_PREVIEW=1 npm run test:ui`. Use `CHROME_PATH` to select desktop Chrome. The UI suite uses isolated contexts, muted output, local queue fixtures, and mocked media contracts.

Coverage includes shared master levels, ignored legacy trim on startup/reload, zero-before-load across four requests, incoming buffering/pause, outgoing interrupted handoffs, autoplay-blocked recovery, remote volume/mute, radio→request→radio, skipped/ended/unavailable requests, station/reconnect behavior, alert tones and actual speech start, blocked speech, late start after watchdog expiry, and existing queue/network/accessibility checks. Native YouTube API telemetry in an isolated muted fixture additionally verifies commanded and reported volume, mute state, ramps, and return to radio. These checks do not replace listening on Justin's TV.

October 30 validation: 121 unit tests, build checks, the full desktop Chrome UI suite, and the Worker dry-run/runtime suite passed. An isolated local fixture using the real YouTube IFrame API, with speaker output muted, verified pause → set player volume 9 → resume restores Board volume 40; native mute → explicit Board 60 clears mute; Board zero reports player volume zero. No acoustic matching or ChromeOS/TV listening test was performed.
