---
name: setup
description: Install, reconnect, or update REDTIXX Agent in Codex using the MCP server address from the user's Redtixx account. Use only for Redtixx connection setup.
---

Ask for the HTTPS MCP server address shown in the user's Redtixx account if it
has not been provided. The address ends in `/mcp/organizer/` or `/mcp/admin/` and
contains no password, authenticator code, or token. Never invent a host or reuse
a development tunnel from another installation.

Locate this plugin's root: two directories above this SKILL.md. Read
`.codex-plugin/plugin.json` to confirm the name is `redtixx`.
Run `node "PLUGIN_ROOT/scripts/setup.mjs" --url "MCP_URL"`. The script prepares
one local marketplace and installs the Redtixx plugin through Codex CLI. It does
not replace unrelated settings or install browser dependencies.

If Codex CLI is missing or lacks `plugin add`, explain that a current Codex CLI
is required; stop rather than editing arbitrary user config files. If the
installation command fails, report its actual error and do not claim success.

Start a new chat when needed for tools/skills to reload. Guide the user through
MCP OAuth in the browser using Codex's connection flow. Do not collect account
credentials or copy OAuth tokens into configuration or chat. Call `get_context`
from the connected Redtixx server. Report the verified role, scope, and whether
writes are enabled; installing a plugin never grants a platform role.
