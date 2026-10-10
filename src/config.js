export const DEFAULT_API_URL = 'https://api.flytrap.dev'
export const API_KEY_PATTERN = /^ft_live_[0-9a-f]{48}$/
export const SIGNUP_URL = 'https://app.flytrap.dev/register'
export const KEYS_URL = 'https://app.flytrap.dev/settings/api-keys'

const isLoopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

export const loadConfig = (env = process.env) => {
    const rawUrl = (env.FLYTRAP_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, '')
    let url
    try {
        url = new URL(rawUrl)
    } catch {
        throw new Error('FLYTRAP_API_URL is not a valid URL')
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url)))
        throw new Error('FLYTRAP_API_URL must use https (http is only allowed for localhost)')
    if (url.username || url.password)
        throw new Error('FLYTRAP_API_URL must not embed credentials')

    const apiKey = (env.FLYTRAP_API_KEY || '').trim() || null
    if (apiKey && !API_KEY_PATTERN.test(apiKey))
        throw new Error('FLYTRAP_API_KEY does not look like a FlyTrap key (expected ft_live_ followed by 48 hex chars)')

    return {apiUrl: url.origin + url.pathname.replace(/\/+$/, ''), apiKey}
}
