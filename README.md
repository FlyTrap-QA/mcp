# @flytrap-qa/mcp

MCP server for [FlyTrap](https://flytrap.dev). It lets the coding agent you already use (Cursor, Claude Code, Codex, Windsurf, Zed, VS Code) read the results of FlyTrap crawls: the bugs FlyTrap found in your app with screenshots, UI XML, logcat and failed network calls, the screen graph, the hosts your build talks to, detected SDKs and permissions, and diffs between two builds.

FlyTrap runs your real Android or iOS build on real devices and records everything. This package only reads those results. It does not run apps, decompile binaries or touch your source tree.

## Quick start

1. Sign in at [app.flytrap.dev](https://app.flytrap.dev), open **Settings > API keys** and create a key. Pick the `read` scope unless you want the agent to be able to queue new crawls.
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
| `compare_builds` | SDK, permission, deep link, host, bug and screen diff between two builds |
| `start_crawl` | Queues a new crawl of the current build. Needs the `crawl` scope and `confirm: true` |

Public catalog (no key): `lookup_app`, `get_app_profile`, `lookup_sdk`, `lookup_permission`.

## Agent skill

`skills/flytrap/SKILL.md` tells an agent when to reach for which tool and how to cite evidence. Copy it into your project's skills folder (for example `.claude/skills/flytrap/SKILL.md` or `.cursor/rules/`) or point your agent at it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLYTRAP_API_KEY` | none | Personal API key from Settings > API keys (`ft_live_...`). Optional for catalog tools |
| `FLYTRAP_API_URL` | `https://api.flytrap.dev` | Override for self-hosted or local API. Must be https unless localhost |

## Security

- The key is sent only to `FLYTRAP_API_URL` as a `Bearer` header, over https. It is never written to disk or logged.
- Keys are scoped. A `read` key cannot start crawls, create keys or change billing, even if the agent asks. Revoke keys any time in the dashboard.
- Keys inherit the project permissions of the user who created them. A key never sees another account's private projects.
- Tool output is bounded (log windows, call caps, 4 MiB per response) and marked as untrusted app data, since bug titles, log lines and URLs originate from the crawled app and its traffic.
- `start_crawl` is the only mutating tool. It requires an explicit `confirm: true` and a key created with the `crawl` scope.

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
