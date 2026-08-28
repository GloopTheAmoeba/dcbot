import { getDiscordClient, stopDiscordBot } from '../lib/discord/bot';
import { getTelegramBot } from '../lib/telegram/bot';
import { runMigrations } from '../lib/db/migrations';
import { logger } from '../lib/logger';

async function main() {
  logger.info('Initializing MouxBot SaaS Background Workers...');

  // 1. Ensure DB migrations are run
  await runMigrations();

  // 2. Start Discord Bot Gateway Client
  const discordClient = getDiscordClient();
  if (discordClient) {
    logger.info('Discord Gateway Listener initialized');
  }

  // 3. Start Telegram Bot Polling if running locally / non-webhook mode
  const telegramBot = getTelegramBot();
  if (telegramBot) {
    logger.info('Telegram Bot Polling worker started');
    telegramBot.start({
      onStart: (info) => logger.info(`Telegram Bot started as @${info.username}`),
    });
  }

  // Graceful Shutdown Handlers
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down services gracefully...`);
    await stopDiscordBot();
    if (telegramBot) {
      await telegramBot.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal error starting bot background worker process', err);
  process.exit(1);
});
