export function deepClone(value) {
  if (Array.isArray(value)) return value.map(item => deepClone(item))
  if (!value || typeof value !== 'object') return value

  const clone = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    clone[key] =
      item instanceof Date ? item.toISOString() : deepClone(item)
  }
  return clone
}

export const delay = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })
