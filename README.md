# @flytrap-qa/mcp

MCP server for [FlyTrap](https://flytrap.dev). It lets the coding agent you already use (Cursor, Claude Code, Codex, Windsurf, Zed, VS Code) read the results of FlyTrap crawls: the bugs FlyTrap found in your app with screenshots, UI XML, logcat and failed network calls, the screen graph, the hosts your build talks to, detected SDKs and permissions, and diffs between two builds.

FlyTrap runs your real Android or iOS build on real devices and records everything. This package only reads those results. It does not run apps, decompile binaries or touch your source tree.

## Quick start

1. Sign in at [dashboard.flytrap.dev](https://dashboard.flytrap.dev), open **Settings > API keys** and create a key. Pick the `read` scope unless you want the agent to be able to queue new crawls.
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

3. Ask things like:

- "Why does onboarding break in my app? Show me the evidence."
- "Which third-party hosts does build 1184 talk to before the consent screen?"
- "What changed between build 1180 and 1184: SDKs, permissions, bugs?"
- "Which SDKs does com.booking ship on Android?" (public catalog, no key needed)

Without `FLYTRAP_API_KEY` the public catalog tools still work.

## Tools

Your projects (need `FLYTRAP_API_KEY`):

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
