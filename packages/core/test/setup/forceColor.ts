// ink-testing-library renders through a non-TTY fake stdout, so chalk defaults to color level 0 and Ink strips
// every themed color from the frame. TUI tests that assert on themed ANSI — the logo shimmer drift, the frozen
// gradient faces, the section-eyebrow fade — need color actually emitted, so force chalk's highest level before
// any test module imports it. An explicit FORCE_COLOR in the environment still wins. chalk's supports-color also
// caps the level at 2 whenever TERM matches `*-256color` (common in CI and default shells), ignoring FORCE_COLOR
// entirely, unless COLORTERM signals truecolor first — set both so truecolor is deterministic regardless of the
// invoking shell's TERM.

process.env["FORCE_COLOR"] ??= "3";
process.env["COLORTERM"] ??= "truecolor";
