export const VERIFY_BUTTON_ID = "adlmet_verify";
export const DISRUPTIONS_SUBSCRIBE_BUTTON_ID = "adlmet_disruptions_subscribe";

/** Action row with “subscribe” button for disruption embeds. */
export function disruptionSubscribeComponents(): {
	type: number;
	components: {
		type: number;
		style: number;
		label: string;
		custom_id: string;
	}[];
}[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 1,
					label: "Get Disruptions Alerts role",
					custom_id: DISRUPTIONS_SUBSCRIBE_BUTTON_ID,
				},
			],
		},
	];
}

export const VERIFY_EMBED = {
	title: "🚌 Adelaide Metro — Member Verification",
	description:
		"Welcome to **Adelaide Public Transport**! Tap the button below to confirm you've read the rules in this channel and unlock the rest of the server.\n\n" +
		"You'll get access to photo channels, general chat, and community events once verified.",
	color: 0xf6c445,
	footer: { text: "Metro Mate • adelaide metro enthusiasts" },
} as const;
