#!/bin/sh
# Pull-based deploy. Cron runs this every 2 minutes. It fetches main;
# on new commits it resets the working tree, reinstalls dependencies if
# the lockfile changed, and restarts the service.
#
# Setup: a read-only deploy key at ~/.ssh/stack_deploy, and a crontab
# entry:
#   */2 * * * * $HOME/stack/deploy/pull.sh >> $HOME/stack/deploy.log 2>&1
#
# The body lives in main() so the shell parses the whole file before
# running any of it: git reset replaces this script mid-run, and an
# incrementally read file would execute a mix of old and new logic.
main() {
  set -e
  DIR="$HOME/stack"
  NODE_BIN="$HOME/.nvm/versions/node/v22.23.2/bin"
  cd "$DIR"

  # One deploy at a time.
  exec 9> .deploy.lock
  flock -n 9 || exit 0

  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/stack_deploy -o IdentitiesOnly=yes"
  git fetch -q origin main
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  [ "$LOCAL" = "$REMOTE" ] && exit 0

  git reset -q --hard origin/main
  if git diff --name-only "$LOCAL" "$REMOTE" | grep -q '^package-lock.json$'; then
    PATH="$NODE_BIN:$PATH" npm ci --omit=dev
  fi

  pkill -f 'src/index.js' || true
  sleep 1
  # 9>&- closes the lock fd for the child: a spawned service that
  # inherits it would hold the deploy lock forever and wedge every
  # later run.
  nohup "$NODE_BIN/node" --env-file=.env src/index.js >> stack.log 2>&1 9>&- &
  echo "$(date -Is) deployed $REMOTE"
}
main
