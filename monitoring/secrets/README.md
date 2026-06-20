# Alertmanager notification secrets

Alertmanager delivers alerts to Telegram and reads both secrets from files in
this directory (so nothing sensitive is committed). The directory is mounted
read-only into the container at `/etc/alertmanager/secrets/` by
`docker-compose.monitoring.yml`. Everything here except this README is gitignored.

Before bringing up the monitoring overlay, create two files **on the box**:

```bash
cd ~/agent-task-market/monitoring/secrets
printf '%s' '<BOT_TOKEN_FROM_BOTFATHER>' > telegram_bot_token   # e.g. 123456:ABC-DEF...
printf '%s' '<TARGET_CHAT_ID>'          > telegram_chat_id      # e.g. -1001234567890
chmod 600 telegram_bot_token telegram_chat_id
```

Get the bot token from @BotFather. Get the chat id by adding the bot to the
target chat and reading `https://api.telegram.org/bot<TOKEN>/getUpdates` (the
`chat.id` field). A group/supergroup id is negative.

`printf` (not `echo`) avoids a trailing newline that would corrupt the token.

To verify after `docker compose ... up -d`:
- `docker compose ... logs alertmanager` — should boot without a config error.
- Trigger a test: visit the Prometheus UI (`:9090`, via SSH tunnel) and check the
  Alerts tab, or wait for a real alert. A resolved test confirms delivery.
