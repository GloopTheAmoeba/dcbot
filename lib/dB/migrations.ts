import { query } from './client';
import { logger } from '../logger';

export async function runMigrations(): Promise<void> {
  try {
    // 1. Create tables if not exist
    await query(`
      CREATE TABLE IF NOT EXISTS admin_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS licenses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          code_hash VARCHAR(64) UNIQUE NOT NULL,
          code_display VARCHAR(32) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          activated_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          telegram_user_id BIGINT UNIQUE NOT NULL,
          username VARCHAR(255),
          first_name VARCHAR(255),
          customer_id UUID UNIQUE NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS discord_guilds (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id VARCHAR(64) UNIQUE NOT NULL,
          guild_name VARCHAR(255) NOT NULL,
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS guild_configurations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id VARCHAR(64) UNIQUE NOT NULL REFERENCES discord_guilds(guild_id) ON DELETE CASCADE,
          notification_channel_id VARCHAR(64),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activation_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
          telegram_user_id BIGINT NOT NULL,
          status VARCHAR(50) NOT NULL,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS license_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
          event_type VARCHAR(50) NOT NULL,
          details JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bot_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id VARCHAR(64) NOT NULL,
          event_type VARCHAR(50) NOT NULL,
          details JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    logger.info('Database migrations verified');
  } catch (err) {
    logger.error('Error running database migrations', err);
  }
}
