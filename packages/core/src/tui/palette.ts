// The TUI's color identity: one batman gold accent over a quiet grey frame. The gold matches the figure's own
// gold (xterm 220 ≈ #ffd700), set as an explicit hex so the chrome reads the same vibrant tone on every terminal
// theme rather than the dull olive an Ink named `yellow` resolves to. Boldness is spent in one place — the accent
// marks selection, focus, and the brand; everything else stays grey/dim so the colored live preview is the
// centerpiece (frontend-design: one signature, quiet surroundings).

export const ACCENT = "#ffd700"; // selection, focus border, brand mark, the suggested dir
export const FRAME = "gray"; // inactive borders and structural dividers
export const OK = "green"; // saved / written
export const DANGER = "red"; // inline errors
