export const API_URL = 'https://api.flytrap.dev'
export const API_KEY_PATTERN = /^ft_live_[0-9a-f]{48}$/
export const SIGNUP_URL = 'https://app.flytrap.dev/register'
export const KEYS_URL = 'https://app.flytrap.dev/settings/api-keys'

export const loadConfig = (env = process.env) => {
    const apiKey = (env.FLYTRAP_API_KEY || '').trim() || null
    if (apiKey && !API_KEY_PATTERN.test(apiKey))
        throw new Error('FLYTRAP_API_KEY does not look like a FlyTrap key (expected ft_live_ followed by 48 hex chars)')

    return {apiUrl: API_URL, apiKey}
}
