#!/bin/sh
# PermissionRequest → long-poll the board. Claude's own terminal dialog stays live meanwhile;
# whichever side answers first wins. Server down → no output → normal terminal flow. Always exit 0.
# $PPID is the claude process (hooks run as its direct children): lets the board retire the card if it dies
curl -s -m 3500 -H 'content-type: application/json' -H "x-claude-pid: $PPID" --data-binary @- "http://127.0.0.1:${AGENT_BOARD_PORT:-4317}/permission" 2>/dev/null
exit 0
