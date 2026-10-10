const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export class FlytrapApiError extends Error {
    constructor(message, {status, hint} = {}) {
        super(message)
        this.name = 'FlytrapApiError'
        this.status = status
        this.hint = hint
    }
}

const hintFor = (status, hasKey) => {
    if (status === 401)
        return hasKey
            ? 'The key was rejected. It may be revoked or expired; create a new one under Settings > API keys.'
            : 'This tool needs FLYTRAP_API_KEY. Create a key in the FlyTrap dashboard under Settings > API keys.'
    if (status === 403)
        return 'The key does not have the scope for this action. start_crawl needs a key created with the "crawl" scope.'
    if (status === 404)
        return 'Not found, or the key owner has no access to this project.'
    if (status === 429)
        return 'Rate limited by the FlyTrap API. Wait a moment and retry.'
    return null
}

export const createClient = ({apiUrl, apiKey, fetchImpl = globalThis.fetch, userAgent = 'flytrap-mcp'}) => {
    const request = async (method, path, {query, body, auth = 'optional'} = {}) => {
        if (auth === 'required' && !apiKey) {
            throw new FlytrapApiError('This tool requires authentication', {
                status: 401, hint: hintFor(401, false),
            })
        }
        const url = new URL(apiUrl + path)
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined && value !== null && value !== '')
                url.searchParams.set(key, String(value))
        }
        const headers = {accept: 'application/json', 'user-agent': userAgent}
        if (apiKey && auth !== 'none')
            headers.authorization = `Bearer ${apiKey}`
        if (body !== undefined)
            headers['content-type'] = 'application/json'

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        let response
        try {
            response = await fetchImpl(url, {
                method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
            })
        } catch (error) {
            throw new FlytrapApiError(error?.name === 'AbortError'
                ? `FlyTrap API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
                : `Could not reach the FlyTrap API at ${url.origin}: ${error?.message ?? error}`)
        } finally {
            clearTimeout(timer)
        }

        const text = await response.text()
        if (text.length > MAX_RESPONSE_BYTES)
            throw new FlytrapApiError(`FlyTrap API response exceeded ${MAX_RESPONSE_BYTES / 1024 / 1024} MiB`)
        let data = null
        if (text) {
            try {
                data = JSON.parse(text)
            } catch {
                data = {message: text.slice(0, 500)}
            }
        }
        if (!response.ok) {
            const message = data?.message || `FlyTrap API returned HTTP ${response.status}`
            throw new FlytrapApiError(message, {status: response.status, hint: hintFor(response.status, Boolean(apiKey))})
        }
        return data
    }

    return {
        get: (path, options) => request('GET', path, options),
        post: (path, options) => request('POST', path, options),
        hasKey: Boolean(apiKey),
    }
}
