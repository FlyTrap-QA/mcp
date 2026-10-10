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
    dashboard_url: `https://app.flytrap.dev/projects/${project.id}`,
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
