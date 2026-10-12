import {z} from 'zod'
import {ok, omit} from '../format.js'

const projectId = z.number().int().positive().describe('FlyTrap project id (from list_projects)')
const PRIVATE_BUILD_FIELDS = ['upload_url', 'binary_ref', 'archive_ref', 'source_ref', 'acquisition_input']

const slimProject = project => ({
    id: project.id,
    name: project.name,
    package_name: project.package_name,
    platform: project.platform,
    source: project.source ?? null,
    pipeline_status: project.pipeline_status ?? project.status ?? null,
    active_build_id: project.active_build_id ?? null,
    selected_crawl_run_id: project.selected_crawl_run_id ?? project.crawl_run_id ?? null,
    updated_at: project.updated_at ?? null,
    dashboard_url: `https://dashboard.flytrap.dev/projects/${project.id}`,
})

const sdkFacts = sdk => ({
    id: sdk.id, name: sdk.name, vendor: sdk.vendor ?? null, category: sdk.category ?? null,
    version: sdk.version ?? null, confidence: sdk.confidence ?? null, evidence_sources: sdk.evidence_sources ?? [],
})

export const registerProjectTools = (server, client) => {
    const auth = 'required'

    server.registerTool('whoami', {
        title: 'Who am I',
        description: 'Confirms which FlyTrap account the configured API key belongs to. Requires FLYTRAP_API_KEY.',
        inputSchema: {},
        annotations: {readOnlyHint: true},
    }, async () => {
        const me = await client.get('/auth/users/me', {auth})
        return ok({email: me.email, role: me.role, key_configured: true}, {note: null})
    })

    server.registerTool('list_projects', {
        title: 'List my projects',
        description: 'Projects (apps) the API key owner can read, with the selected crawl run for each. '
            + 'Start here to get project ids. Requires FLYTRAP_API_KEY.',
        inputSchema: {
            q: z.string().min(1).max(200).optional().describe('Case-insensitive substring of name or package_name'),
            platform: z.enum(['android', 'ios']).optional(),
            limit: z.number().int().min(1).max(50).default(20),
            offset: z.number().int().min(0).default(0),
        },
        annotations: {readOnlyHint: true},
    }, async ({q, platform, limit, offset}) => {
        const projects = await client.get('/project/projects', {query: {q, platform, limit, offset}, auth})
        const list = (Array.isArray(projects) ? projects : []).map(slimProject)
        return ok({count: list.length, offset, projects: list})
    })

    server.registerTool('get_project', {
        title: 'Get a project',
        description: 'One project with its pipeline status and the latest crawl state. Requires FLYTRAP_API_KEY.',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const [project, status] = await Promise.all([
            client.get(`/project/projects/${project_id}`, {auth}),
            client.get(`/project/projects/${project_id}/status`, {auth}).catch(() => null),
        ])
        return ok({...slimProject(project), crawl_status: status})
    })

    server.registerTool('list_builds', {
        title: 'List builds of a project',
        description: 'Builds (versions) registered for a project, with binary digests and which build is current. '
            + 'Use two build ids with compare_builds. Requires FLYTRAP_API_KEY.',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const builds = await client.get(`/project/projects/${project_id}/builds`, {auth})
        return ok({project_id, builds: (Array.isArray(builds) ? builds : []).map(b => omit(b, PRIVATE_BUILD_FIELDS))})
    })

    server.registerTool('get_build_summary', {
        title: 'Get build summary',
        description: 'One-screen summary of the selected crawl run: version, size, SDK and permission counts, '
            + 'bug and test counts, screens crawled, network and performance totals, binary SHA-256. '
            + 'Requires FLYTRAP_API_KEY.',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const summary = await client.get(`/project/projects/${project_id}/summary`, {auth})
        const build = summary.build ? {
            ...omit(summary.build, ['sdks', 'permissions', 'deep_links']),
            sdk_count: summary.build.sdks?.length ?? null,
            permission_count: summary.build.permissions?.length ?? null,
            deep_link_count: summary.build.deep_links?.length ?? null,
        } : null
        return ok({...summary, build}, {lead: 'Use get_sdks for the SDK list, list_bugs for bugs.'})
    })

    server.registerTool('get_sdks', {
        title: 'Get detected SDKs and permissions',
        description: 'Third-party SDKs detected in the selected build (with confidence and evidence sources) plus '
            + 'declared permissions and deep links. Requires FLYTRAP_API_KEY.',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const summary = await client.get(`/project/projects/${project_id}/summary`, {auth})
        return ok({
            run: summary.run,
            sdks: (summary.build?.sdks ?? []).map(sdkFacts),
            permissions: summary.build?.permissions ?? [],
            deep_links: summary.build?.deep_links ?? [],
            missing: summary.missing ?? [],
        })
    })

    server.registerTool('list_bugs', {
        title: 'List bugs',
        description: 'Bugs FlyTrap found in the selected crawl run, sorted by severity. Each has an id for '
            + 'get_bug_evidence. Requires FLYTRAP_API_KEY.',
        inputSchema: {
            project_id: projectId,
            status: z.enum(['open', 'resolved']).optional(),
            severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
            limit: z.number().int().min(1).max(100).default(25),
            offset: z.number().int().min(0).default(0),
        },
        annotations: {readOnlyHint: true},
    }, async ({project_id, ...query}) => {
        const data = await client.get(`/project/projects/${project_id}/bugs`, {query, auth})
        return ok(data)
    })

    server.registerTool('get_bug_evidence', {
        title: 'Get bug evidence',
        description: 'Everything FlyTrap recorded for one bug: the test scenario and failed step, screenshots and '
            + 'UI XML (signed URLs, valid for a short time), the logcat error window, failed network calls, '
            + 'performance peaks and a ready-to-use ai_prompt. Cite run.crawl_run_id and the screenshot path when '
            + 'you explain the bug. Requires FLYTRAP_API_KEY.',
        inputSchema: {
            project_id: projectId,
            bug_id: z.string().min(1).max(100).describe('Bug id from list_bugs, e.g. "BUG-102"'),
        },
        annotations: {readOnlyHint: true},
    }, async ({project_id, bug_id}) => {
        const data = await client.get(`/project/projects/${project_id}/bugs/${encodeURIComponent(bug_id)}/evidence`, {auth})
        return ok(data, {lead: `Evidence for ${bug_id} from crawl run ${data?.run?.crawl_run_id ?? '?'}. `
            + 'Signed URLs expire; fetch screenshots now if you need to look at them.'})
    })

    server.registerTool('get_screen_graph', {
        title: 'Get screen graph',
        description: 'Screens the crawler reached in the selected run and the tap edges between them '
            + '(from -> to via element). Useful for "how do I get to X" and dead-end questions. Requires FLYTRAP_API_KEY.',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const data = await client.get(`/project/projects/${project_id}/screen-graph`, {auth})
        return ok(data)
    })

    server.registerTool('get_network_hosts', {
        title: 'Get network hosts',
        description: 'Hosts the app talked to during the crawl with call counts, bytes and error rates, plus '
            + 'FlyTrap\'s network insight. Use it for "which third parties receive data" and pre-consent traffic '
            + 'questions. Requires FLYTRAP_API_KEY.',
        inputSchema: {
            project_id: projectId,
            limit: z.number().int().min(1).max(200).default(50),
        },
        annotations: {readOnlyHint: true},
    }, async ({project_id, limit}) => {
        const data = await client.get(`/project/projects/${project_id}/network-summary`, {query: {limit}, auth})
        return ok(data)
    })

    server.registerTool('compare_builds', {
        title: 'Compare two builds',
        description: 'Diff two builds of the same project: SDKs, permissions, deep links, network hosts, bugs and '
            + 'screens added or removed, size and open-bug deltas. Both builds need a completed crawl. '
            + 'Requires FLYTRAP_API_KEY.',
        inputSchema: {
            project_id: projectId,
            base_build_id: z.number().int().positive().describe('Older build id (from list_builds)'),
            head_build_id: z.number().int().positive().describe('Newer build id'),
        },
        annotations: {readOnlyHint: true},
    }, async ({project_id, base_build_id, head_build_id}) => {
        const data = await client.get(`/project/projects/${project_id}/compare`,
            {query: {base_build_id, head_build_id}, auth})
        return ok(data)
    })

    server.registerTool('search_apps', {
        title: 'Find apps by describing what they do',
        description: 'Semantic search over FlyTrap\'s crawled feature index: describe the app you want '
            + '("a budgeting app with shared expenses and recurring reminders") and get the public apps whose '
            + 'observed in-app features cover it, with the matched and missing requirements per app. Use for '
            + 'competitor and market research; use lookup_app when you already know the app name or package id.',
        inputSchema: {
            query: z.string().min(3).max(600).describe('Plain-language description of the wanted app'),
            platform: z.enum(['android', 'ios']).optional(),
            limit: z.number().int().min(1).max(25).default(10),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({query, platform, limit}) => {
        const data = await client.post('/project/app-search', {body: {query, platform, limit}, auth})
        return ok({
            query: data.query,
            interpretation: data.interpretation,
            summary: data.summary,
            apps: (data.apps ?? []).map(app => ({
                project_id: app.project?.id,
                name: app.project?.name,
                package_name: app.project?.package_name,
                platform: app.project?.platform,
                genre: app.project?.genre ?? null,
                match_score: app.match_score,
                requirement_coverage: app.requirement_coverage,
                app_kind_score: app.app_kind_score,
                feature_count: app.feature_count,
                app_overview: app.app_overview ?? null,
                matched_features: (app.matched_features ?? []).map(f => ({
                    functional_id: f.functional_id,
                    name: f.functional_display_name ?? f.app_specific_name ?? null,
                    score: f.score,
                    requirements: f.requirements,
                })),
                unmatched_requirements: app.unmatched_requirements ?? [],
                profile_url: `https://flytrap.dev/apps/${encodeURIComponent(app.project?.package_name ?? '')}`,
            })),
            next: 'Pass a project_id to get_ux_benchmark to put the user\'s app next to these, or get_app_profile '
                + 'with the package_name for SDKs and permissions.',
        })
    })

    server.registerTool('get_ux_benchmark', {
        title: 'UX benchmark: your features next to other apps',
        description: 'Names the features in the project\'s build and finds the same feature in public apps FlyTrap '
            + 'has crawled, with screenshots of each. Returns the feature rows, the compared apps (pinned '
            + 'competitors first, then the most downloaded apps in the same store genre, or every app by shared '
            + 'functions with match: "overlap"), how many features they share and signed screenshot URLs.',
        inputSchema: {
            project_id: projectId,
            match: z.enum(['genre', 'overlap']).default('genre'),
            limit: z.number().int().min(1).max(25).default(10).describe('Apps to compare against'),
        },
        annotations: {readOnlyHint: true},
    }, async ({project_id, match, limit}) => {
        const data = await client.get('/project/relevant-apps', {query: {project_id, match, limit}, auth})
        const screens = feature => (feature.screens ?? []).slice(0, 3)
            .map(screen => ({name: screen.name, url: screen.url ?? null}))
        return ok({
            project: slimProject(data.project ?? {}),
            match: data.match,
            genre: data.genre ?? null,
            summary: data.summary,
            features: (data.features ?? []).map(feature => ({
                functional_id: feature.functional_id,
                name: feature.functional_display_name ?? feature.app_specific_name ?? null,
                domain: feature.domain ?? null,
                shared_app_count: feature.shared_app_count,
                screenshot_app_count: feature.screenshot_app_count,
                screen_count: feature.screen_count,
                screens: screens(feature),
            })),
            apps: (data.apps ?? []).map(app => ({
                project_id: app.project?.id,
                name: app.project?.name,
                package_name: app.project?.package_name,
                platform: app.project?.platform,
                genre: app.project?.genre ?? null,
                source: app.source,
                download_count: app.download_count,
                shared_feature_count: app.shared_feature_count,
                feature_count: app.feature_count,
                overlap_ratio: app.overlap_ratio,
                screens_matched: app.screens_matched,
                features: (app.features ?? []).map(feature => ({
                    functional_id: feature.functional_id,
                    app_specific_name: feature.app_specific_name ?? null,
                    screens: screens(feature),
                })),
            })),
            dashboard_url: `https://dashboard.flytrap.dev/ux-benchmark/${project_id}`,
        })
    })

    const slimCompetitor = c => ({
        project_id: c.id, name: c.name, package_name: c.package_name, platform: c.platform,
        genre: c.genre ?? null, download_count: c.download_count ?? null, feature_count: c.feature_count ?? null,
        ...(c.added_at ? {added_at: c.added_at} : {}), ...(c.is_competitor !== undefined ? {is_competitor: c.is_competitor} : {}),
    })

    server.registerTool('list_competitors', {
        title: 'List pinned competitors',
        description: 'Competitors pinned to a project. They always lead the UX benchmark (get_ux_benchmark).',
        inputSchema: {project_id: projectId},
        annotations: {readOnlyHint: true},
    }, async ({project_id}) => {
        const data = await client.get(`/project/projects/${project_id}/competitors`, {auth})
        return ok({project_id, count: (data ?? []).length, competitors: (data ?? []).map(slimCompetitor)})
    })

    server.registerTool('find_competitors', {
        title: 'Find apps to pin as competitors',
        description: 'Searches two places: public FlyTrap projects that already have a crawled feature catalog '
            + '(ready to pin now) and Google Play (not crawled yet; add_competitor creates the project first). '
            + 'Pass the result to add_competitor.',
        inputSchema: {
            project_id: projectId,
            q: z.string().min(1).max(30).describe('App name or package id, e.g. "revolut"'),
            limit: z.number().int().min(1).max(20).default(10),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({project_id, q, limit}) => {
        const [crawled, store] = await Promise.all([
            client.get(`/project/projects/${project_id}/competitor-candidates`, {query: {q, limit}, auth}),
            client.get('/project/market-apps', {query: {term: q, platform: 'android'}, auth}).catch(() => []),
        ])
        const crawledPackages = new Set((crawled ?? []).map(c => c.package_name))
        return ok({
            query: q,
            crawled_apps: (crawled ?? []).map(slimCompetitor),
            google_play_apps: (Array.isArray(store) ? store : []).slice(0, limit)
                .filter(item => item?.appId && !crawledPackages.has(item.appId))
                .map(item => ({package_name: item.appId, name: item.title ?? null, developer: item.developer ?? null})),
            next: 'add_competitor with project_id + competitor_project_id (crawled app) or package_name (Google Play app).',
        })
    })

    server.registerTool('add_competitor', {
        title: 'Pin a competitor',
        description: 'Pins an app to the project\'s UX benchmark. Give competitor_project_id for an app from '
            + 'find_competitors.crawled_apps, or package_name for a Google Play app: FlyTrap then creates a public '
            + 'store project for it and crawls it (10 to 40 minutes, uses crawl quota) before pinning. Needs the '
            + '"crawl" scope. Ask the user before creating a new store project; pass confirm: true for that case.',
        inputSchema: {
            project_id: projectId,
            competitor_project_id: z.number().int().positive().optional().describe('Existing public FlyTrap project'),
            package_name: z.string().min(3).max(200).optional().describe('Google Play package id, e.g. com.revolut.revolut'),
            name: z.string().max(100).optional().describe('Display name for a newly created store project'),
            confirm: z.boolean().optional().describe('Required (true) when package_name would create a new project'),
        },
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    }, async ({project_id, competitor_project_id, package_name, name, confirm}) => {
        let competitorId = competitor_project_id ?? null
        let created = null
        if (!competitorId && !package_name)
            throw new Error('Pass competitor_project_id or package_name')
        if (!competitorId) {
            const candidates = await client.get(`/project/projects/${project_id}/competitor-candidates`,
                {query: {q: package_name, limit: 20}, auth})
            const existing = (candidates ?? []).find(c => c.package_name === package_name && c.platform === 'android')
            if (existing) {
                competitorId = existing.id
            } else {
                if (confirm !== true)
                    throw new Error(`${package_name} is not crawled yet. Creating a store project queues a crawl `
                        + '(10 to 40 minutes, uses quota). Ask the user, then call again with confirm: true.')
                created = await client.post('/project/projects', {auth, body: {
                    ...(name ? {name} : {}),
                    platform: 'android',
                    supported_languages: 'en_US',
                    source: 'playstore',
                    package_name,
                }})
                competitorId = created.id
            }
        }
        const competitors = await client.post(`/project/projects/${project_id}/competitors`,
            {body: {competitor_project_id: competitorId}, auth})
        return ok({
            project_id,
            pinned_project_id: competitorId,
            created_project: created ? {...slimProject(created), note: 'Crawl queued; benchmark rows fill in when it completes.'} : null,
            competitors: (competitors ?? []).map(slimCompetitor),
        })
    })

    server.registerTool('remove_competitor', {
        title: 'Unpin a competitor',
        description: 'Removes a pinned competitor from the project\'s UX benchmark. The competitor project itself is kept. Needs the "crawl" scope.',
        inputSchema: {project_id: projectId, competitor_project_id: z.number().int().positive()},
        annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: true},
    }, async ({project_id, competitor_project_id}) => {
        const competitors = await client.delete(`/project/projects/${project_id}/competitors/${competitor_project_id}`, {auth})
        return ok({project_id, removed_project_id: competitor_project_id, competitors: (competitors ?? []).map(slimCompetitor)})
    })

    server.registerTool('start_crawl', {
        title: 'Start a crawl',
        description: 'Queues a new crawl of the project\'s current build. This consumes crawl quota and takes '
            + '10 to 40 minutes. Only call it when the user explicitly asks to re-run or re-test; pass '
            + 'confirm: true to acknowledge. Needs a key created with the "crawl" scope and write access to the project.',
        inputSchema: {
            project_id: projectId,
            confirm: z.literal(true).describe('Must be true. Confirms the user asked for a new crawl.'),
        },
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    }, async ({project_id}) => {
        const data = await client.post(`/project/projects/${project_id}/crawl`, {body: {}, auth})
        return ok({...data, next: 'Poll get_project for crawl_status; results appear when run_status is complete.'},
            {note: null})
    })
}
