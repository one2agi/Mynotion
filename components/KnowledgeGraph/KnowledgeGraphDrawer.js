import { Dialog } from '@headlessui/react'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'
import { useKnowledgeGraphDarkMode } from './appearance'
import {
  normalizeKnowledgeGraphDepth,
  normalizeKnowledgeGraphId,
  selectGraphNeighborhood
} from './graphView'

const KnowledgeGraphCanvas = dynamic(() => import('./KnowledgeGraphCanvas'), {
  ssr: false
})

const emptyGraph = { nodes: [], edges: [] }
const INITIALIZING_POLL_DELAY = 2_000
const INITIALIZING_POLL_MAX_DELAY = 10_000

export const getInitializingPollDelay = attempt =>
  Math.min(
    INITIALIZING_POLL_DELAY * 2 ** Math.max(0, attempt),
    INITIALIZING_POLL_MAX_DELAY
  )

const isPublicGraph = value =>
  Array.isArray(value?.nodes) && Array.isArray(value?.edges)

const KnowledgeGraphDrawer = ({
  allLinkPages,
  depth,
  isDarkMode,
  isOpen,
  onClose,
  post
}) => {
  const closeButtonRef = useRef(null)
  const router = useRouter()
  const hasCurrentPost = Boolean(post?.id)
  const darkMode = useKnowledgeGraphDarkMode(isDarkMode)
  const [graph, setGraph] = useState(null)
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState(hasCurrentPost ? 'local' : 'full')
  const [retryCount, setRetryCount] = useState(0)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const localDepth = normalizeKnowledgeGraphDepth(depth)
  const currentId = normalizeKnowledgeGraphId(post?.id)

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
        const response = await fetch(
          '/api/knowledge-graph',
          pollCount > 0 ? { cache: 'no-store' } : undefined
        )
        if (cancelled) return

        if (response.status === 202) {
          setStatus('initializing')
          const delay = getInitializingPollDelay(pollCount)
          pollCount += 1
          pollTimer = window.setTimeout(() => {
            void loadGraph()
          }, delay)
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
  }, [isOpen, retryCount])

  useEffect(() => {
    const closeForRouteChange = () => onClose()
    router.events?.on('routeChangeComplete', closeForRouteChange)

    return () => router.events?.off('routeChangeComplete', closeForRouteChange)
  }, [onClose, router.events])

  const displayedGraph = useMemo(() => {
    if (!graph) return emptyGraph
    if (mode === 'local' && currentId) {
      return selectGraphNeighborhood(graph, currentId, localDepth)
    }

    return graph
  }, [currentId, graph, localDepth, mode])

  useEffect(() => {
    if (displayedGraph.nodes.some(node => node.id === selectedNodeId)) return
    const initialNode =
      displayedGraph.nodes.find(node => node.id === currentId) ||
      displayedGraph.nodes[0]
    setSelectedNodeId(initialNode?.id || '')
  }, [currentId, displayedGraph.nodes, selectedNodeId])

  const navigateToNode = node => {
    const nodeId = normalizePageId(node?.id)
    const canonicalPage = nodeId
      ? allLinkPages?.find(
          page =>
            normalizePageId(page?.id) === nodeId &&
            typeof page?.href === 'string' &&
            page.href
        )
      : null
    const target = canonicalPage?.href || node?.href || node?.slug
    if (target) router.push(target)
  }

  const navigateToSelectedNode = () => {
    navigateToNode(
      displayedGraph.nodes.find(node => node.id === selectedNodeId)
    )
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
                <div className='flex items-center gap-3 p-4'>
                  <p className='text-sm text-gray-500 dark:text-gray-400'>
                    知识图谱暂不可用
                  </p>
                  <button
                    aria-label='重试加载知识图谱'
                    className='flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                    onClick={() => setRetryCount(value => value + 1)}
                    title='重试加载知识图谱'
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
                      <path d='M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' />
                    </svg>
                  </button>
                </div>
              ) : null}
              {showEmpty ? (
                <p className='p-4 text-sm text-gray-500 dark:text-gray-400'>
                  暂无文章关系
                </p>
              ) : null}
              {status === 'ready' && !showEmpty ? (
                <div className='flex h-full min-h-0 flex-col'>
                  <div className='flex shrink-0 items-center gap-2 border-b border-gray-200 p-2 dark:border-gray-800'>
                    <select
                      aria-label='选择图谱文章'
                      className='min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
                      onChange={event => setSelectedNodeId(event.target.value)}
                      value={selectedNodeId}
                    >
                      {displayedGraph.nodes.map(node => (
                        <option key={node.id} value={node.id}>
                          {node.title}
                        </option>
                      ))}
                    </select>
                    <button
                      aria-label='打开所选文章'
                      className='flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                      onClick={navigateToSelectedNode}
                      title='打开所选文章'
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
                        <path d='M5 12h14M13 6l6 6-6 6' />
                      </svg>
                    </button>
                  </div>
                  <div className='min-h-0 flex-1'>
                    <KnowledgeGraphCanvas
                      active={isOpen}
                      currentId={currentId}
                      graph={displayedGraph}
                      isDarkMode={isDarkMode}
                      onNodeClick={navigateToNode}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export default KnowledgeGraphDrawer
