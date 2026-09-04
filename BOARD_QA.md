# Board projector QA

The Board is a passive display. Events retain the original balanced groups of up
to three. Controls and hover effects are not part of the kiosk presentation.
Service-status groups change without a scrolling marquee. The standard dashboard
and its controls remain separate.

Event body type never shrinks below 20 CSS px. At 1920px it is about 26px and at
3840px about 52px. Overflow becomes stationary, automatically advancing reading
panels every 25 seconds, with service/title context retained. The complete text is
preserved; it is not all simultaneous when a notice exceeds the physical space.
Dense event pages dwell long enough to show every reading panel. Refreshes with
unchanged incidents retain their current page and reading position.

## Reproduce the visual checks

Run `npm ci`, then `npm run qa:board -- three 1920 1080`, then `npm run dev`.
Open `/qa.html` on the development server. Supported scenarios: `three`, `two`,
`five`, `dense`, `clear`, `unknown`. Width and height set the iframe's actual CSS
viewport; the wrapper scales the image for inspection without changing layout.
The fixtures are synthetic, do not run production polling, and are excluded from
deployment. Inspect `#tv-board`'s `data-qa` attribute inside the iframe for its
viewport-fit, clock-fit, per-card text preservation, and panel-overflow results.

## Browser checks performed

- 1280 × 720: three events, dense notices and two events.
- 1920 × 1080: three events, dense notices and unavailable-data state.
- 1024 × 768: five events in balanced groups, with observed automatic advancement
  from three cards to the remaining two.
- 3840 × 2160: three events and all-clear state.
- Long-notice panels: concatenated text matches the original exactly; individual
  panels fit their body areas without scrolling.
- Clock: AM/PM remains on the same line; page dimensions fit the viewport.

These are representative browser tests, not a physical projector calibration or
a validation of upstream service APIs. Projection brightness, browser zoom, font
rendering and viewing distance should still be checked on the actual installation.
