// Feature flags — hide, don't delete.
//
// Every flag gates UI entry points and generation only. The underlying code
// paths (renderers, motion engine, exporters) stay compiled in, so a page
// saved with that feature's data still loads and renders; flipping a flag
// back to true restores the feature exactly as it was.
//
//   motion   — the "Motion" toolbar button, the Design/Motion inspector tab
//              switcher, the timeline panel, Space play/pause, Preview-mode
//              playback and the Video export tab. Saved motion data is
//              kept on the element but never played.
//   subject  — the "+ Subject" toolbar button, its `k` shortcut, and any
//              subject element Randomize/Inspo would otherwise generate.
//              Existing subject layers on saved pages still render.
export const FEATURES = {
  motion: false,
  subject: false,
} as const

export type FeatureKey = keyof typeof FEATURES
