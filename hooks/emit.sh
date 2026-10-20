#!/bin/sh
# Hook → POST /event via curl (node startup alone is ~70ms; curl is ~15ms). No stdout, always exit 0.
curl -s -m 0.3 -o /dev/null -H 'content-type: application/json' --data-binary @- "http://127.0.0.1:${AGENT_BOARD_PORT:-4317}/event" >/dev/null 2>&1
exit 0
