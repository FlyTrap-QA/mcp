import {z} from 'zod'
import {ok} from '../format.js'

const slim = app => ({
    package_name: app.package_name,
    name: app.name,
    platform: app.platform,
    version_code: app.version_code ?? null,
    build_framework: app.build_framework ?? null,
    genre: app.genre ?? null,
    developer_name: app.developer_name ?? null,
    download_count: app.download_count ?? null,
    sdk_count: Array.isArray(app.sdk_ids) ? app.sdk_ids.length : (Array.isArray(app.sdks) ? app.sdks.length : null),
    permission_count: Array.isArray(app.permissions) ? app.permissions.length : null,
    short_description: app.short_description ?? null,
    updated_at: app.updated_at ?? null,
})

export const registerCatalogTools = (server, client) => {
    server.registerTool('lookup_app', {
        title: 'Look up a public app',
        description: 'Search the public FlyTrap catalog of crawled store apps by name or package id. '
            + 'Returns package_name values to pass to get_app_profile. No API key needed.',
        inputSchema: {
            q: z.string().min(1).max(100).describe('App name or package id substring, e.g. "booking" or "com.booking"'),
            platform: z.enum(['android', 'ios']).optional(),
            sdk: z.string().max(200).optional().describe('Comma-separated SDK ids the app must contain, e.g. "firebase-analytics,adjust"'),
            permission: z.string().max(300).optional().describe('Comma-separated permission ids the app must declare'),
            limit: z.number().int().min(1).max(25).default(10),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({q, platform, sdk, permission, limit}) => {
        const data = await client.get('/app-catalog/packages', {query: {q, platform, sdk, permission, limit}, auth: 'none'})
        const items = (data?.items ?? []).map(slim)
        return ok({query: q, count: items.length, apps: items, next_cursor: data?.next_cursor ?? null})
    })

    server.registerTool('get_app_profile', {
        title: 'Get a public app profile',
        description: 'Detected SDKs, declared permissions, labels, framework and a crawl-derived summary for one app '
            + 'in the public catalog. Use the package_name from lookup_app. No API key needed.',
        inputSchema: {
            package_name: z.string().min(2).max(200).describe('Android package id or iOS bundle id, e.g. "com.booking"'),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({package_name}) => {
        const app = await client.get(`/app-catalog/packages/${encodeURIComponent(package_name)}`, {auth: 'none'})
        return ok({
            ...slim(app),
            app_summary: app.app_summary ?? null,
            labels: app.labels ?? [],
            sdks: (app.sdks ?? []).map(sdk => ({id: sdk.id, name: sdk.name, vendor: sdk.vendor, category: sdk.category})),
            permissions: (app.permissions ?? []).map(p => ({id: p.id, name: p.name, category: p.category})),
            crawl_run_id: app.crawl_run_id ?? null,
            profile_url: `https://flytrap.dev/apps/${encodeURIComponent(app.package_name)}`,
        })
    })

    server.registerTool('lookup_sdk', {
        title: 'Look up an SDK in the FlyTrap catalog',
        description: 'Find SDK ids by name or vendor (e.g. "adjust", "google", "ads"). Use the id with lookup_app or '
            + 'to interpret get_sdks output. No API key needed.',
        inputSchema: {
            q: z.string().max(100).optional().describe('Substring of SDK id, name, vendor or category; omit to list categories'),
            limit: z.number().int().min(1).max(50).default(20),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({q, limit}) => {
        const sdks = await client.get('/app-catalog/sdks', {auth: 'none'})
        const list = Array.isArray(sdks) ? sdks : []
        if (!q) {
            const categories = {}
            for (const sdk of list)
                categories[sdk.category ?? 'other'] = (categories[sdk.category ?? 'other'] ?? 0) + 1
            return ok({total: list.length, categories})
        }
        const needle = q.toLowerCase()
        const matches = list.filter(sdk => [sdk.id, sdk.name, sdk.vendor, sdk.category, sdk.family]
            .some(value => typeof value === 'string' && value.toLowerCase().includes(needle)))
            .slice(0, limit)
            .map(sdk => ({id: sdk.id, name: sdk.name, vendor: sdk.vendor, category: sdk.category, family: sdk.family}))
        return ok({query: q, count: matches.length, sdks: matches})
    })

    server.registerTool('lookup_permission', {
        title: 'Look up an Android permission',
        description: 'Explain a permission id or find permissions by keyword (e.g. "location", "camera"). No API key needed.',
        inputSchema: {
            q: z.string().min(1).max(100).describe('Permission id or keyword, e.g. "android.permission.CAMERA" or "location"'),
            limit: z.number().int().min(1).max(50).default(20),
        },
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({q, limit}) => {
        const permissions = await client.get('/app-catalog/permissions', {auth: 'none'})
        const needle = q.toLowerCase()
        const matches = (Array.isArray(permissions) ? permissions : [])
            .filter(p => [p.id, p.name, p.category, p.description]
                .some(value => typeof value === 'string' && value.toLowerCase().includes(needle)))
            .slice(0, limit)
        return ok({query: q, count: matches.length, permissions: matches})
    })
}
