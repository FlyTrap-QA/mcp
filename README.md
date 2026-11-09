# @flytrap-qa/mcp

MCP server for [FlyTrap](https://flytrap.dev/mcp).

FlyTrap uses your Android or iOS app on real devices the way a new user would: signing in, going through onboarding, searching, hitting the wrong password screen. In about 30 minutes you get a list of where it breaks. This server puts that list in the coding agent you already use (Claude, Cursor, VS Code, Devin, Codex, Windsurf, Zed), with the screenshot, UI XML, logcat and failed network calls for every bug, so the agent can go and fix them.

It can also read the screen graph, the hosts your build talks to, detected SDKs and permissions, and what changed between two builds. It only reads results. It does not run apps, decompile binaries or touch your source tree.

There are two ways to connect: the hosted server (nothing to install, you sign in with your FlyTrap account) or this npm package running locally with an API key.

## Hosted server

URL: `https://api.flytrap.dev/mcp` (Streamable HTTP, OAuth)

Add it as a remote MCP server. Your agent opens a browser, you sign in to FlyTrap and click **Allow**. Read access is always on; tick **Also allow starting crawls** only if you want the agent to queue crawls. The connection shows up in the dashboard under **Settings > API keys**, and you can revoke it there.

- **Claude** (claude.ai, Claude Desktop): Settings > Connectors > Add custom connector, paste the URL.
- **Claude Code**: `claude mcp add --transport http flytrap https://api.flytrap.dev/mcp`, then run `/mcp`, pick flytrap and choose Authenticate.
- **Cursor** (`~/.cursor/mcp.json`): `{ "mcpServers": { "flytrap": { "url": "https://api.flytrap.dev/mcp" } } }`
- **VS Code** (`.vscode/mcp.json`): `{ "servers": { "flytrap": { "type": "http", "url": "https://api.flytrap.dev/mcp" } } }`
- **Devin**: Customize > MCPs > Add custom MCP, HTTP transport, paste the URL, authentication OAuth, then Connect.

If your client can't do the browser sign-in, send an API key instead: `Authorization: Bearer ft_live_...`.

## Local package

1. Sign in at [dashboard.flytrap.dev](https://dashboard.flytrap.dev), open **Settings > API keys** and create a key. Leave **Allow starting crawls** off unless you want the agent to be able to queue new crawls.
2. Add the server to your agent:

```json
{
  "mcpServers": {
    "flytrap": {
      "command": "npx",
      "args": ["-y", "@flytrap-qa/mcp@latest"],
      "env": {
        "FLYTRAP_API_KEY": "ft_live_..."
      }
    }
  }
}
```

Claude Code: `claude mcp add flytrap -e FLYTRAP_API_KEY=ft_live_... -- npx -y @flytrap-qa/mcp@latest`

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.flytrap]
command = "npx"
args = ["-y", "@flytrap-qa/mcp@latest"]
env = { FLYTRAP_API_KEY = "ft_live_..." }
```

## What to ask

- "Where does my app break? Show me the evidence."
- "Which third-party hosts does build 1184 talk to before the consent screen?"
- "What changed between build 1180 and 1184: SDKs, permissions, bugs?"
- "Which SDKs does com.booking ship on Android?" (public catalog, no key needed)

Without `FLYTRAP_API_KEY` the public catalog tools still work.

## Tools

Your projects (need a sign-in on the hosted server, or `FLYTRAP_API_KEY` locally):

| Tool | What it returns |
| --- | --- |
| `whoami` | The account the key belongs to |
| `list_projects` | Projects the key owner can read, with the selected crawl run |
| `get_project` | One project plus its live crawl status |
| `list_builds` | Builds of a project with binary SHA-256 and provenance |
| `get_build_summary` | Version, size, SDK/permission counts, bug and test counts, screens, network and performance totals |
| `get_sdks` | Detected SDKs with confidence and evidence sources, declared permissions, deep links |
| `list_bugs` | Bugs from the selected run, sorted by severity |
| `get_bug_evidence` | Scenario, failed step, screenshots and XML (signed URLs), logcat error window, failed network calls, performance peaks, a ready `ai_prompt` |
| `get_screen_graph` | Screens reached and the tap edges between them |
| `get_network_hosts` | Hosts contacted with call counts, bytes and error rates |
| `search_apps` | Describe an app in plain language, get the crawled public apps whose observed features cover it, with matched and missing requirements |
| `get_ux_benchmark` | Your build's features next to the same feature in competitor and same-genre apps, with screenshots |
| `list_competitors` | Competitors pinned to a project's UX benchmark |
| `find_competitors` | Search crawled public apps and Google Play for apps to pin |
| `add_competitor` | Pin a crawled app, or create a store project from a Google Play package and pin it (`crawl` scope, `confirm: true` to create) |
| `remove_competitor` | Unpin a competitor (`crawl` scope) |
| `compare_builds` | SDK, permission, deep link, host, bug and screen diff between two builds |
| `start_crawl` | Queues a new crawl of the current build. Needs the `crawl` scope and `confirm: true` |

Public catalog (no key): `lookup_app`, `get_app_profile`, `lookup_sdk`, `lookup_permission`.

## Agent skill

`skills/flytrap/SKILL.md` tells an agent when to reach for which tool and how to cite evidence. Copy it into your project's skills folder (for example `.claude/skills/flytrap/SKILL.md` or `.cursor/rules/`) or point your agent at it.

## Configuration

The only setting is `FLYTRAP_API_KEY`: your personal key from Settings > API keys (`ft_live_...`). It is optional for the public catalog tools. The server always talks to `https://api.flytrap.dev`.

## Security

- The key is sent only to `https://api.flytrap.dev` as a `Bearer` header, over https. It is never written to disk or logged.
- Keys are scoped. A `read` key cannot start crawls, create keys or change billing, even if the agent asks. Revoke keys any time in the dashboard.
- Keys inherit the project permissions of the user who created them. A key never sees another account's private projects.
- Tool output is bounded (log windows, call caps, 4 MiB per response) and marked as untrusted app data, since bug titles, log lines and URLs originate from the crawled app and its traffic.
- `start_crawl`, `add_competitor` and `remove_competitor` are the only tools that change anything; they need a key created with the `crawl` scope. Queuing a crawl (`start_crawl`, or `add_competitor` with a Google Play package) also requires an explicit `confirm: true`.

## REST instead of MCP

Every tool maps to a REST endpoint, so an agent that can run `curl` can do the same without this package:

```bash
curl -H "Authorization: Bearer $FLYTRAP_API_KEY" https://api.flytrap.dev/project/projects
curl -H "Authorization: Bearer $FLYTRAP_API_KEY" https://api.flytrap.dev/project/projects/1248/bugs
curl -H "Authorization: Bearer $FLYTRAP_API_KEY" https://api.flytrap.dev/project/projects/1248/bugs/BUG-102/evidence
```

API reference: https://api.flytrap.dev/docs

## Development

```bash
npm install
npm test
FLYTRAP_API_KEY=ft_live_... npm run inspect   # MCP Inspector UI
```

Requires Node 20 or newer. Published from GitHub Actions on tags (`v*`) with npm provenance.
