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
chmod 644 telegram_bot_token telegram_chat_id
```

> **Mode 644, not 600.** The alertmanager container runs as `nobody`, not the
> host uid that owns these files. With 600 the container can't read them and the
> entrypoint aborts with "telegram_chat_id missing or empty" (a read failure, not
> a literally empty file). 644 is fine on a single-tenant box. The bot token is
> thus world-readable *on the host* — acceptable for beta; rotate it at launch.

Get the bot token from @BotFather. Get the chat id by adding the bot to the
target chat and reading `https://api.telegram.org/bot<TOKEN>/getUpdates` (the
`chat.id` field). A group/supergroup id is negative.

`printf` (not `echo`) avoids a trailing newline that would corrupt the token.

> **Why two mechanisms.** The bot token is read directly by Alertmanager via
> `bot_token_file` (never enters the config or git). The chat id can't use a file —
> `chat_id_file` was added *after* Alertmanager v0.27.0 (the pinned version), so the
> container's entrypoint renders the chat id from `telegram_chat_id` into the config
> at start (`__CHAT_ID__` placeholder → inline int). The chat id is a destination,
> not a secret; the file just keeps the operator step to "drop two files". The
> entrypoint exits loudly if `telegram_chat_id` is missing or empty.

To verify after `docker compose ... up -d`:
- `docker compose ... logs alertmanager` — should boot without a config error.
- Trigger a test: visit the Prometheus UI (`:9090`, via SSH tunnel) and check the
  Alerts tab, or wait for a real alert. A resolved test confirms delivery.
