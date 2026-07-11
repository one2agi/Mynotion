import { useEffect, useState } from 'react'

export const documentIsDarkMode = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')

export const useKnowledgeGraphDarkMode = explicitValue => {
  const [documentDarkMode, setDocumentDarkMode] = useState(documentIsDarkMode)

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return

    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setDocumentDarkMode(root.classList.contains('dark'))
    })

    observer.observe(root, { attributeFilter: ['class'], attributes: true })
    return () => observer.disconnect()
  }, [])

  return explicitValue ?? documentDarkMode
}
