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
    assert.equal(projects.structuredContent.projects[0].dashboard_url, 'https://app.flytrap.dev/projects/7')
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
