const LONG_REPLY_PATTERN =
	/\b(explain(?:\s+in)?\s+detail|detailed|elaborate|essay|long(?:\s+answer)?|yap+|rant|tell me everything|break it down|step by step|deep dive|everything about)\b/i;

/** True when the user probably wants more than a one-liner. */
export function wantsLongReply(question: string): boolean {
	const trimmed = question.trim();
	if (trimmed.length >= 280) return true;
	if ((trimmed.match(/\?/g) ?? []).length >= 2) return true;
	return LONG_REPLY_PATTERN.test(trimmed);
}

export function replyLengthHint(wantsLong: boolean): string {
	return wantsLong ?
			"Length: user wants detail — up to ~8 sentences if needed."
		:	"Length: default SHORT — 1–3 sentences (~60 words max). No essays unless they asked for detail.";
}

export function defaultMaxTokensForQuestion(question: string, configuredMax: number): number {
	const cap = Math.max(64, configuredMax);
	if (wantsLongReply(question)) return Math.min(cap, 650);
	return Math.min(cap, 220);
}
