import { getSiteRole } from '@/lib/site-role'

type RevalidationReply = {
  ok?: unknown
  results?: Array<{ path?: unknown; revalidated?: unknown }>
}

type RevalidateContentPathOptions = {
  path: string
  revalidateLocal: (path: string) => Promise<void>
  siteRole?: string
  landingUrl?: string
  token?: string
  fetchImpl?: typeof fetch
}

export async function revalidateContentPath({
  path,
  revalidateLocal,
  siteRole = getSiteRole(),
  landingUrl = process.env.LANDING_REVALIDATION_URL || '',
  token = process.env.REVALIDATION_TOKEN || '',
  fetchImpl = fetch
}: RevalidateContentPathOptions): Promise<void> {
  await revalidateLocal(path)

  if (siteRole !== 'content' || path !== '/') return

  try {
    if (!landingUrl || !token) throw new Error('missing configuration')
    const endpoint = new URL(landingUrl)
    if (!/^https?:$/.test(endpoint.protocol))
      throw new Error('invalid endpoint')

    const response = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: '/' })
    })
    if (!response.ok) throw new Error('non-success response')

    const payload = (await response.json()) as RevalidationReply
    const homepageSucceeded =
      payload?.ok === true &&
      Array.isArray(payload.results) &&
      payload.results.some(
        result => result?.path === '/' && result?.revalidated === true
      )
    if (!homepageSucceeded) throw new Error('negative response')
  } catch {
    throw new Error('Landing homepage revalidation failed')
  }
}
