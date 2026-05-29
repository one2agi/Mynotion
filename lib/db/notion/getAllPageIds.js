import BLOG from '@/blog.config'

export default function getAllPageIds(
  collectionQuery,
  collectionId,
  collectionView,
  viewIds,
  block = {}
) {
  const targetViewId = getTargetViewId(viewIds)
  const targetView = getCollectionViewValue(collectionView, targetViewId)
  const pageSort = getPageSort(targetView)
  const viewQuery = collectionQuery?.[collectionId]

  if (viewQuery) {
    const selectedViewData = targetViewId ? viewQuery[targetViewId] : null

    if (selectedViewData && hasQueryResult(selectedViewData)) {
      const queryIds = getBlockIdsFromViewData(selectedViewData)
      return orderByPageSort(queryIds, pageSort)
    }

    if (!targetViewId) {
      return unique(Object.values(viewQuery).flatMap(getBlockIdsFromViewData))
    }
  }

  // Older Notion payloads may not include collection_query. In that case,
  // page_sort is the only available source for database row ids.
  return pageSort
}

function getTargetViewId(viewIds) {
  if (!Array.isArray(viewIds) || viewIds.length === 0) return null

  const rawIndex = Number(BLOG.NOTION_INDEX || 0)
  const index = Number.isFinite(rawIndex) ? rawIndex : 0
  return index < 0 ? viewIds[viewIds.length + index] : viewIds[index]
}

function getCollectionViewValue(collectionView, targetViewId) {
  if (!collectionView || !targetViewId) return null

  const viewEntry = collectionView?.[targetViewId]
  return viewEntry?.value?.value || viewEntry?.value || null
}

function getPageSort(collectionViewValue) {
  const pageSort = collectionViewValue?.page_sort
  return Array.isArray(pageSort) ? pageSort : []
}

function getBlockIdsFromViewData(viewData) {
  const ids = []
  const append = blockIds => {
    if (Array.isArray(blockIds)) ids.push(...blockIds)
  }

  append(viewData?.collection_group_results?.blockIds)
  append(viewData?.results?.blockIds)
  append(viewData?.blockIds)

  for (const value of Object.values(viewData || {})) {
    append(value?.blockIds)

    if (Array.isArray(value?.results)) {
      value.results.forEach(result => append(result?.blockIds))
    }
  }

  return unique(ids)
}

function hasQueryResult(viewData) {
  if (!viewData) return false

  if (
    hasBlockIds(viewData?.collection_group_results) ||
    hasBlockIds(viewData?.results) ||
    Array.isArray(viewData?.blockIds)
  ) {
    return true
  }

  return Object.values(viewData).some(value => {
    if (hasBlockIds(value)) return true

    return Array.isArray(value?.results)
      ? value.results.some(result => hasBlockIds(result))
      : false
  })
}

function hasBlockIds(value) {
  return Array.isArray(value?.blockIds)
}

function orderByPageSort(blockIds, pageSort) {
  if (!pageSort.length) return blockIds

  const blockIdSet = new Set(blockIds)
  const sortedIds = pageSort.filter(id => blockIdSet.has(id))
  const sortedIdSet = new Set(sortedIds)

  blockIds.forEach(id => {
    if (!sortedIdSet.has(id)) sortedIds.push(id)
  })

  return sortedIds
}

function unique(ids) {
  return [...new Set(ids.filter(Boolean))]
}
