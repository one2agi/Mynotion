import dynamic from 'next/dynamic'
import { useCallback, useRef, useState } from 'react'

const KnowledgeGraphLauncher = ({ post, isDarkMode }) => {
  const launcherRef = useRef(null)
  const [Drawer, setDrawer] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  const closeDrawer = useCallback(() => {
    setIsOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }, [])

  const openDrawer = () => {
    if (!Drawer) {
      setDrawer(() =>
        dynamic(() => import('./KnowledgeGraphDrawer'), {
          ssr: false
        })
      )
    }

    setIsOpen(true)
  }

  return (
    <>
      <button
        aria-label='知识图谱'
        className='fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 shadow-lg transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-950'
        onClick={openDrawer}
        ref={launcherRef}
        title='知识图谱'
        type='button'
      >
        <svg
          aria-hidden='true'
          className='h-5 w-5'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.75'
          viewBox='0 0 24 24'
        >
          <circle cx='6' cy='7' r='2.25' />
          <circle cx='18' cy='6' r='2.25' />
          <circle cx='14' cy='18' r='2.25' />
          <path d='m7.9 8.3 8.1-1.6M7.4 8.8l5.2 7.5m4.5-8.1-2.1 7.6' />
        </svg>
      </button>
      {Drawer ? (
        <Drawer
          isDarkMode={isDarkMode}
          isOpen={isOpen}
          onClose={closeDrawer}
          post={post}
        />
      ) : null}
    </>
  )
}

export default KnowledgeGraphLauncher
