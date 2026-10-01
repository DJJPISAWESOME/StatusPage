# Kiosk audio consistency

The Board previously sent YouTube the radio slider's full value on ready, and only faded videos after radio fallback. Consecutive requests inherited the previous video's full gain. Radio fallback could finish its fade while the stream was still connecting.

This patch applies a separate, device-persisted YouTube trim (50% by default; 10–100% in dashboard settings). Every request receives volume zero before `loadVideoById`, then ramps over 1.1 seconds after its matching PLAYING event. Pause/buffering holds an unfinished ramp; resume continues it. Listener volume changes and zero-volume mute remain authoritative during ramps. Radio starts/reconnects at zero and ramps after the media element's playing event. Queue/lease/rotation behavior is unchanged.

The default is a conservative starting point, not a measured match. At listener volume 40%, default YouTube volume is 20/100 while radio is 0.4. The APIs' numerical scales are not equivalent loudness measurements. The patch cannot prevent every transient, ad or iframe-internal behavior; controls use the official asynchronous IFrame API rather than a sample-level limiter.

## Calibration

1. Keep the TV/speakers at a low, safe volume. Open dashboard settings and start with YouTube relative volume at 50%.
2. Compare familiar radio material with several quiet and loud requested songs. Reduce the trim if videos are still too loud. The trim stays on this browser after reload; switching radio stations may require recalibration.
3. Use the Board/remote volume for the overall level; zero mutes both sources. Trim only affects YouTube and never boosts above the listener's selected volume. Avoid using the iframe's own volume slider as the calibration control because later Board updates reapply the Board setting.
4. Optional **Auto level audio** uses Chrome's user-authorized capture of this verified Board tab to measure RMS and reactively attenuate YouTube. Its gain recovers slowly on quieter passages but never exceeds the calibrated trim. Permission must be renewed after reload. Silence, pauses, transitions and alert speech suspend adaptation. It is neither integrated LUFS normalization nor peak limiting, and cannot know the next recording's loudness before it starts. It does not level radio.

## Feasibility

[YouTube's official IFrame API](https://developers.google.com/youtube/iframe_api_reference#Playback_controls) exposes playback and a 0–100 volume control, without PCM samples or loudness metadata. The host cannot connect iframe audio to its Web Audio compressor/analyser. Reliable, automatic per-content normalization of arbitrary YouTube requests is therefore unavailable to this unattended page.

[Web Audio's cross-origin security rules](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceNode-security) require silence for a media source classified as CORS-cross-origin. Broadcaster CORS permission is necessary for direct Web Audio measurement/processing; ordinary stream playback alone is insufficient. Routing the existing arbitrary radio catalog through Web Audio risks silent radio, so this patch preserves direct broadcaster playback and does not add CORS requirements, download media, proxy audio, or extract YouTube audio.

Truly hands-off normalization across both sources needs output-side TV/receiver/OS audio processing, or authorized media sources that expose usable audio/loudness information. This patch provides calibrated attenuation and gentler transitions without claiming automatic content normalization.

## Verification

Run `npm test`, `npm run build`, and `SIGNAL_START_PREVIEW=1 npm run test:ui`. Chrome can be selected with `CHROME_PATH`. The UI suite launches with audio muted and uses mocked YouTube/media contracts; `scripts/audio-ui.mjs` also runs independently against an already-running preview server.

Coverage includes zero-before-load for four videos, pause/buffering, autoplay-blocked recovery, mute and volume edits during ramps, remote pause/resume/volume, radio→video→radio, unavailable-video fallback, stop/reconnect, saved trim, delayed radio playback/retry, simulated RMS loud-to-quiet recovery, and existing queue and channel rotation checks. Simulated leveler and player tests do not establish audible matching or sample-level safety on Justin's TV. Hardware listening/calibration remains outstanding.

## Radio return regression investigation (October 2026)

On main `0268233`, the ordinary return sequence fades YouTube out, stops it, sets radio transition gain to zero, starts the selected stream, and ramps radio to its master setting after `playing`. At master 0.4, radio is 0.4 before and after requests; default YouTube commands peak at 20/100. The optional capture graph connects only to an analyser, never the destination. Capture attenuation affects YouTube alone. Neither those numerical scales nor synthetic media measurements establish equivalent perceived loudness on the TV.

Three reproducible restoration hazards were found and fixed:

- Board alerts wrote duck/restore values into the radio element. Its `volumechange` handler promoted those temporary output levels into the master setting, so a 0.4 master became 0.1 during a 25% duck and changed back on restore. Alerts now use a separate gain composed with both sources. Restore releases only that gain, preserving concurrent remote mute/volume, fades, trim, and capture attenuation.
- A late radio reconnect or repeated `playing` event during radio-to-request fade-out restarted the radio fade toward one, cancelled the handoff callback, and could stall request playback. Radio connect/playing gain changes now require active fallback outside a handoff. The fallback flag is established before starting the stream, including synchronous playback callbacks.

YouTube buffering/pause events could cancel an outgoing fade and its radio-start callback. Those events now hold only incoming ramps, allowing an outgoing handoff to finish.

The media element is now an output only. Master changes enter through the slider or remote command and update the same saved preference, including remote mute. Startup applies that preference explicitly rather than depending on asynchronous media events. No source trim, capture permission, network filter, or queue policy changed.

These fixes remove demonstrated state bugs; the reported extremely loud request-to-radio experience has not been reproduced acoustically. A TV comparison of the same radio material before and after a request is still needed. Radio and YouTube may have different programme loudness even when all commanded gains are correct. Do not assume that lowering YouTube further fixes loud radio.
