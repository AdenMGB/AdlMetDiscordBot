import { fetchBotIdentity } from "./discord-rest";
import { loadDotEnv, readConfig } from "./env";
import { startDiscordGateway } from "./gateway";

loadDotEnv();

const config = readConfig();

console.log("Metro Mate Discord AI runner (Ubuntu) — NVIDIA streaming, no Worker relay");

const bot = await fetchBotIdentity(config.discordBotToken);
console.log(`Bot identity: ${bot.username} (${bot.id})`);

startDiscordGateway(config, bot.id, (username: string) => {
	console.log(`Gateway READY as ${username}`);
});
