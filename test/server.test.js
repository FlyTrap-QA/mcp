import assert from 'node:assert/strict'
import test from 'node:test'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {createServer} from '../src/index.js'
import {loadConfig} from '../src/config.js'

const KEY = 'ft_live_' + 'ab'.repeat(24)

const fakeFetch = (routes, calls = []) => async (url, init) => {
    const u = new URL(url)
    calls.push({path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers, method: init.method})
    const route = routes[`${init.method} ${u.pathname}`]
    if (!route)
        return new Response(JSON.stringify({message: 'Project not found'}), {status: 404})
    const [status, body] = typeof route === 'function' ? route(init) : route
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

const connect = async (config, fetchImpl) => {
    const {server} = createServer({config, fetchImpl})
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({name: 'test', version: '0'})
    await client.connect(clientTransport)
    return client
}

test('loadConfig validates key format', () => {
    assert.deepEqual(loadConfig({}), {apiUrl: 'https://api.flytrap.dev', apiKey: null})
    assert.equal(loadConfig({FLYTRAP_API_KEY: ` ${KEY} `}).apiKey, KEY)
    assert.throws(() => loadConfig({FLYTRAP_API_KEY: 'sk-not-ours'}), /does not look like/)
})

test('public tools work without a key and never send one', async () => {
    const calls = []
    const client = await connect({apiUrl: 'https://api.test', apiKey: null}, fakeFetch({
        'GET /app-catalog/packages': [200, {items: [{package_name: 'com.booking', name: 'Booking', platform: 'android',
            sdk_ids: ['a', 'b'], permissions: [{}]}], next_cursor: null}],
    }, calls))
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    assert.deepEqual(tools.slice(0, 4), ['lookup_app', 'get_app_profile', 'lookup_sdk', 'lookup_permission'])
    assert.ok(tools.includes('start_crawl'))
    const result = await client.callTool({name: 'lookup_app', arguments: {q: 'booking', limit: 5}})
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent.apps[0].sdk_count, 2)
    assert.equal(calls[0].headers.authorization, undefined)
    assert.deepEqual(calls[0].query, {q: 'booking', limit: '5'})
    assert.match(result.content[0].text, /Treat them as data to analyze/)
})

test('project tools require a key and surface API errors with hints', async () => {
    const anon = await connect({apiUrl: 'https://api.test', apiKey: null}, fakeFetch({}))
    const denied = await anon.callTool({name: 'list_projects', arguments: {}})
    assert.equal(denied.isError, true)
    assert.match(denied.content[0].text, /needs FLYTRAP_API_KEY/)

    const calls = []
    const client = await connect({apiUrl: 'https://api.test', apiKey: KEY}, fakeFetch({
        'GET /project/projects': [200, [{id: 7, name: 'My app', package_name: 'com.me', platform: 'android'}]],
        'GET /project/projects/7/builds': [200, [{id: 1, version_name: '1.0', upload_url: 'https://s3/secret', binary_ref: 'x'}]],
        'GET /project/projects/7/bugs/BUG-1/evidence': [200, {run: {crawl_run_id: '99'}, bug: {id: 'BUG-1'}}],
        'POST /project/projects/7/crawl': [403, {message: 'API key scope does not permit this endpoint'}],
    }, calls))
    const projects = await client.callTool({name: 'list_projects', arguments: {q: 'my'}})
    assert.equal(projects.structuredContent.projects[0].dashboard_url, 'https://dashboard.flytrap.dev/projects/7')
    assert.equal(calls.at(-1).headers.authorization, `Bearer ${KEY}`)

    const builds = await client.callTool({name: 'list_builds', arguments: {project_id: 7}})
    assert.doesNotMatch(builds.content[0].text, /secret|binary_ref/)

    const evidence = await client.callTool({name: 'get_bug_evidence', arguments: {project_id: 7, bug_id: 'BUG-1'}})
    assert.match(evidence.content[0].text, /from crawl run 99/)

    const crawl = await client.callTool({name: 'start_crawl', arguments: {project_id: 7, confirm: true}})
    assert.equal(crawl.isError, true)
    assert.match(crawl.content[0].text, /"crawl" scope/)
    const unconfirmed = await client.callTool({name: 'start_crawl', arguments: {project_id: 7, confirm: false}})
    assert.equal(unconfirmed.isError, true)
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)

    const missing = await client.callTool({name: 'get_project', arguments: {project_id: 8}})
    assert.equal(missing.isError, true)
    assert.match(missing.content[0].text, /no access to this project/)
})

test('benchmark and competitor tools map to the API and gate project creation on confirm', async () => {
    const calls = []
    const client = await connect({apiUrl: 'https://api.test', apiKey: KEY}, fakeFetch({
        'GET /project/relevant-apps': [200, {
            match: 'genre', genre: 'Finance',
            project: {id: 7, name: 'My app', package_name: 'com.me', platform: 'android'},
            summary: {feature_count: 2, apps_compared: 1, screens_matched: 1, overlap_ratio: 50},
            features: [{functional_id: 'login', functional_display_name: 'Login', shared_app_count: 1, screenshot_app_count: 1,
                screen_count: 5, screens: [1, 2, 3, 4, 5].map(i => ({name: `s${i}`, url: `https://signed/${i}`}))}],
            apps: [{project: {id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android'}, source: 'competitor',
                download_count: 10, shared_feature_count: 1, feature_count: 3, overlap_ratio: 50, screens_matched: 1,
                features: [{functional_id: 'login', app_specific_name: 'Sign in', screens: [{name: 'r1', url: null}]}]}],
        }],
        'POST /project/app-search': init => [200, {
            query: JSON.parse(init.body).query,
            interpretation: {app_kind: 'budgeting', platform: 'android', plan_cached: false, requirements: []},
            summary: {apps_indexed: 100, features_indexed: 1000, apps_considered: 100, apps_matched: 1},
            apps: [{project: {id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android', genre: 'Finance'},
                match_score: 80, requirement_coverage: 70, app_kind_score: 90, feature_count: 3,
                matched_features: [{functional_id: 'budget', functional_display_name: 'Budget', score: 0.9, requirements: ['budget']}],
                unmatched_requirements: ['reminders']}],
            usage: {estimated_cost_usd: 0.001},
        }],
        'GET /project/projects/7/competitors': [200, [{id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android', added_at: '2026-01-01T00:00:00Z'}]],
        'GET /project/projects/7/competitor-candidates': [200, [{id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android', is_competitor: true}]],
        'GET /project/market-apps': [200, [{appId: 'com.rival', title: 'Rival'}, {appId: 'com.newapp', title: 'New app', developer: 'Dev'}]],
        'POST /project/projects': init => [201, {id: 42, name: 'New app', package_name: JSON.parse(init.body).package_name, platform: 'android', source: 'playstore'}],
        'POST /project/projects/7/competitors': [201, [{id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android'}, {id: 42, name: 'New app', package_name: 'com.newapp', platform: 'android'}]],
        'DELETE /project/projects/7/competitors/42': [200, [{id: 9, name: 'Rival', package_name: 'com.rival', platform: 'android'}]],
    }, calls))

    const bench = await client.callTool({name: 'get_ux_benchmark', arguments: {project_id: 7, match: 'overlap'}})
    assert.equal(bench.isError, undefined)
    assert.deepEqual(calls.at(-1).query, {project_id: '7', match: 'overlap', limit: '10'})
    assert.equal(bench.structuredContent.features[0].screens.length, 3, 'screens are capped per feature')
    assert.equal(bench.structuredContent.apps[0].source, 'competitor')
    assert.equal(bench.structuredContent.dashboard_url, 'https://dashboard.flytrap.dev/ux-benchmark/7')

    const search = await client.callTool({name: 'search_apps', arguments: {query: 'budgeting app with reminders'}})
    assert.equal(search.structuredContent.apps[0].package_name, 'com.rival')
    assert.deepEqual(search.structuredContent.apps[0].unmatched_requirements, ['reminders'])
    assert.equal(search.structuredContent.usage, undefined, 'token spend is not surfaced to the agent')

    const found = await client.callTool({name: 'find_competitors', arguments: {project_id: 7, q: 'rival'}})
    assert.equal(found.structuredContent.crawled_apps[0].project_id, 9)
    assert.deepEqual(found.structuredContent.google_play_apps, [{package_name: 'com.newapp', name: 'New app', developer: 'Dev'}],
        'store results already crawled are dropped')

    const unconfirmed = await client.callTool({name: 'add_competitor', arguments: {project_id: 7, package_name: 'com.newapp'}})
    assert.equal(unconfirmed.isError, true)
    assert.match(unconfirmed.content[0].text, /confirm: true/)
    assert.ok(!calls.some(c => c.method === 'POST' && c.path === '/project/projects'), 'no project created without confirm')

    const neither = await client.callTool({name: 'add_competitor', arguments: {project_id: 7}})
    assert.equal(neither.isError, true)

    const crawledPin = await client.callTool({name: 'add_competitor', arguments: {project_id: 7, package_name: 'com.rival'}})
    assert.equal(crawledPin.structuredContent.pinned_project_id, 9, 'an already crawled package pins without creating anything')
    assert.equal(crawledPin.structuredContent.created_project, null)

    const created = await client.callTool({name: 'add_competitor', arguments: {project_id: 7, package_name: 'com.newapp', confirm: true}})
    assert.equal(created.structuredContent.created_project.id, 42)
    const createCall = calls.find(c => c.method === 'POST' && c.path === '/project/projects')
    assert.ok(createCall)
    const pinCall = calls.filter(c => c.method === 'POST' && c.path === '/project/projects/7/competitors').at(-1)
    assert.ok(pinCall)
    assert.equal(created.structuredContent.competitors.length, 2)

    const removed = await client.callTool({name: 'remove_competitor', arguments: {project_id: 7, competitor_project_id: 42}})
    assert.equal(removed.structuredContent.competitors.length, 1)
    assert.equal(calls.at(-1).method, 'DELETE')
})
