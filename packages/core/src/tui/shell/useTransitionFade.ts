// A discrete color-step fade for section transitions. On a transitionKey change it resets to step 0 and advances
// through FADE_STEPS ticks to full via a self-clearing interval — the timer is cleared both on cleanup and the
// moment it reaches full, so no interval leaks past the transition. Under reducedMotion it returns full (1)
// immediately and starts no timer. The returned level (0..1) is color-only; callers brighten a token, never move
// a glyph, so the motion carries no meaning of its own.

import { useEffect, useState } from "react";

const FADE_STEPS = 2; // two ticks → three discrete levels: 0, 0.5, 1
const FADE_STEP_MS = 90;

export function useTransitionFade(transitionKey: string | number, reducedMotion: boolean): number {
	const [step, setStep] = useState<number>(reducedMotion ? FADE_STEPS : 0);
	useEffect(() => {
		if (reducedMotion) {
			setStep(FADE_STEPS);
			return;
		}
		setStep(0);
		let current = 0;
		const id = setInterval(() => {
			current += 1;
			setStep(current);
			if (current >= FADE_STEPS) clearInterval(id);
		}, FADE_STEP_MS);
		return () => {
			clearInterval(id);
		};
	}, [transitionKey, reducedMotion]);
	return step / FADE_STEPS;
}
