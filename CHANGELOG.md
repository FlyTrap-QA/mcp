# Changelog

## 0.1.0

- First release: stdio MCP server with project tools (list_projects, get_project, list_builds, get_build_summary, get_sdks, list_bugs, get_bug_evidence, get_screen_graph, get_network_hosts, compare_builds, start_crawl, whoami) and public catalog tools (lookup_app, get_app_profile, lookup_sdk, lookup_permission).
- Scoped `ft_live_` API keys over https only; `start_crawl` requires the `crawl` scope and `confirm: true`.
