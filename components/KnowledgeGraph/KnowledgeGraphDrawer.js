import { Dialog } from '@headlessui/react'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useKnowledgeGraphDarkMode } from './appearance'
import { selectGraphNeighborhood } from './graphView'

const KnowledgeGraphCanvas = dynamic(() => import('./KnowledgeGraphCanvas'), {
  ssr: false
})

const emptyGraph = { nodes: [], edges: [] }
const INITIALIZING_POLL_DELAY = 2_000
const INITIALIZING_POLL_LIMIT = 3

const isPublicGraph = value =>
  Array.isArray(value?.nodes) && Array.isArray(value?.edges)

const KnowledgeGraphDrawer = ({ isDarkMode, isOpen, onClose, post }) => {
  const closeButtonRef = useRef(null)
  const router = useRouter()
  const hasCurrentPost = Boolean(post?.id)
  const darkMode = useKnowledgeGraphDarkMode(isDarkMode)
  const [graph, setGraph] = useState(null)
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState(hasCurrentPost ? 'local' : 'full')

  useEffect(() => {
    if (!isOpen) return

    closeButtonRef.current?.focus()
    setMode(hasCurrentPost ? 'local' : 'full')
  }, [hasCurrentPost, isOpen])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    let pollCount = 0
    let pollTimer
    setStatus('loading')
    setGraph(null)

    const loadGraph = async () => {
      try {
        const response = await fetch('/api/knowledge-graph')
        if (cancelled) return

        if (response.status === 202) {
          setStatus('initializing')
          if (pollCount < INITIALIZING_POLL_LIMIT) {
            pollCount += 1
            pollTimer = window.setTimeout(loadGraph, INITIALIZING_POLL_DELAY)
          }
          return
        }

        if (!response.ok) {
          setStatus('unavailable')
          return
        }

        const responseGraph = await response.json()
        if (cancelled) return
        if (isPublicGraph(responseGraph)) {
          setGraph(responseGraph)
          setStatus('ready')
        } else {
          setStatus('unavailable')
        }
      } catch {
        if (!cancelled) setStatus('unavailable')
      }
    }

    void loadGraph()

    return () => {
      cancelled = true
      window.clearTimeout(pollTimer)
    }
  }, [isOpen])

  useEffect(() => {
    const closeForRouteChange = () => onClose()
    router.events?.on('routeChangeComplete', closeForRouteChange)

    return () => router.events?.off('routeChangeComplete', closeForRouteChange)
  }, [onClose, router.events])

  const displayedGraph = useMemo(() => {
    if (!graph) return emptyGraph
    if (mode === 'local' && post?.id) {
      return selectGraphNeighborhood(graph, post.id, 1)
    }

    return graph
  }, [graph, mode, post?.id])

  const navigateToNode = node => {
    if (node?.slug) router.push(node.slug)
  }

  const showEmpty = status === 'ready' && displayedGraph.edges.length === 0
  const panelColor = darkMode
    ? 'border-gray-700 bg-gray-950 text-gray-100'
    : 'border-gray-200 bg-white text-gray-900'

  return (
    <Dialog
      as='div'
      className='fixed inset-0 z-50 flex justify-end'
      initialFocus={closeButtonRef}
      onClose={onClose}
      open={isOpen}
    >
      <Dialog.Overlay className='absolute inset-0 cursor-default bg-black/45' />
      <div className='relative flex h-full w-full max-w-[420px]'>
        <Dialog.Panel
          as='section'
          className={`flex h-full w-full flex-col border-l shadow-2xl ${panelColor}`}
          data-testid='knowledge-graph-panel'
        >
          <header className='flex min-h-14 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800'>
            <Dialog.Title as='h2' className='text-sm font-semibold'>
              知识图谱
            </Dialog.Title>
            <button
              aria-label='关闭知识图谱'
              className='flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-gray-800 dark:hover:text-gray-100'
              onClick={onClose}
              ref={closeButtonRef}
              title='关闭知识图谱'
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
                <path d='m6 6 12 12M18 6 6 18' />
              </svg>
            </button>
          </header>
          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800'>
              {hasCurrentPost ? (
                <button
                  aria-label='查看当前文章关系'
                  aria-pressed={mode === 'local'}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    mode === 'local'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setMode('local')}
                  title='查看当前文章关系'
                  type='button'
                >
                  <svg
                    aria-hidden='true'
                    className='h-4 w-4'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.75'
                    viewBox='0 0 24 24'
                  >
                    <path d='M4 12h16M12 4v16' />
                    <circle cx='12' cy='12' r='3.5' />
                  </svg>
                </button>
              ) : null}
              <button
                aria-label='查看完整关系图'
                aria-pressed={mode === 'full'}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  mode === 'full'
                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => setMode('full')}
                title='查看完整关系图'
                type='button'
              >
                <svg
                  aria-hidden='true'
                  className='h-4 w-4'
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
              {hasCurrentPost && mode === 'full' ? (
                <button
                  aria-label='返回当前文章关系'
                  className='flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                  onClick={() => setMode('local')}
                  title='返回当前文章关系'
                  type='button'
                >
                  <svg
                    aria-hidden='true'
                    className='h-4 w-4'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.75'
                    viewBox='0 0 24 24'
                  >
                    <path d='M10 6 4 12l6 6M4 12h16' />
                  </svg>
                </button>
              ) : null}
            </div>
            <div className='min-h-0 flex-1'>
              {status === 'loading' ? (
                <p className='p-4 text-sm text-gray-500 dark:text-gray-400'>
                  加载知识图谱中
                </p>
              ) : null}
              {status === 'initializing' ? (
                <p className='p-4 text-sm text-gray-500 dark:text-gray-400'>
                  知识图谱正在初始化
                </p>
              ) : null}
              {status === 'unavailable' ? (
                <p className='p-4 text-sm text-gray-500 dark:text-gray-400'>
                  知识图谱暂不可用
                </p>
              ) : null}
              {showEmpty ? (
                <p className='p-4 text-sm text-gray-500 dark:text-gray-400'>
                  暂无文章关系
                </p>
              ) : null}
              {status === 'ready' && !showEmpty ? (
                <KnowledgeGraphCanvas
                  active={isOpen}
                  currentId={post?.id}
                  graph={displayedGraph}
                  isDarkMode={isDarkMode}
                  onNodeClick={navigateToNode}
                />
              ) : null}
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export default KnowledgeGraphDrawer
