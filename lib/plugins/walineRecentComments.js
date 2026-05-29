export const getWalineRecentComments = async options => {
  const { RecentComments } = await import('@waline/client')
  return RecentComments(options)
}
