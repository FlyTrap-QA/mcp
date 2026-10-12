import {createRequire} from 'node:module'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {loadConfig} from './config.js'
import {createClient} from './client.js'
import {failure} from './format.js'
import {registerCatalogTools} from './tools/catalog.js'
import {registerProjectTools} from './tools/projects.js'

const {version} = createRequire(import.meta.url)('../package.json')

const INSTRUCTIONS = `FlyTrap crawls real Android and iOS builds on devices and records what happened: screens, bugs with
screenshots and logs, network traffic, SDKs and permissions, performance. Public catalog tools (lookup_app,
get_app_profile, lookup_sdk, lookup_permission) need no key. Project tools need FLYTRAP_API_KEY and only see the
key owner's projects. Typical flow: list_projects -> list_bugs -> get_bug_evidence (cite run.crawl_run_id and the
screenshot path). start_crawl is the only mutating tool; ask the user before calling it.`

export const createServer = ({config, fetchImpl} = {}) => {
    const resolved = config ?? loadConfig()
    const client = createClient({...resolved, fetchImpl, userAgent: `flytrap-mcp/${version}`})
    const server = new McpServer({name: 'flytrap', version}, {instructions: INSTRUCTIONS})

    const originalRegister = server.registerTool.bind(server)
    server.registerTool = (name, spec, handler) => originalRegister(name, spec, async (...args) => {
        try {
            return await handler(...args)
        } catch (error) {
            return failure(error)
        }
    })

    registerCatalogTools(server, client)
    registerProjectTools(server, client)
    return {server, client, config: resolved}
}

export const main = async () => {
    const {server, config} = createServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(`flytrap-mcp ${version} ready (${config.apiKey ? 'authenticated' : 'public catalog only'})\n`)
}
