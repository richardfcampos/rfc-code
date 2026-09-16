#!/bin/sh
# rfc-code-server runs with OOMScoreAdjust=-900 so the OOM killer spares it.
# Everything it spawns inherits that score, which would shield runaway MCP
# servers and builds too, so restore a killable score before handing over.
exec choom -n 500 -- __TARGET__ "$@"
