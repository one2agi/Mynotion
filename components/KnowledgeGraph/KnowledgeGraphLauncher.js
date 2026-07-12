import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampLauncherPosition,
  isLauncherDrag,
  loadLauncherPosition,
  saveLauncherPosition
} from './launcherPosition'

const LAUNCHER_SIZE = { height: 44, width: 44 }

const getViewport = () => ({
  height: window.innerHeight,
  width: window.innerWidth
})

const getDefaultPosition = () => ({
  x: window.innerWidth - LAUNCHER_SIZE.width - 20,
  y: window.innerHeight - LAUNCHER_SIZE.height - 20
})

const KnowledgeGraphLauncher = ({ allLinkPages, depth, post, isDarkMode }) => {
  const launcherRef = useRef(null)
  const pointerStateRef = useRef(null)
  const suppressClickRef = useRef(false)
  const [Drawer, setDrawer] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState(null)

  useEffect(() => {
    const updatePosition = () => {
      setPosition(current => {
        const next = current
          ? clampLauncherPosition(current, getViewport(), LAUNCHER_SIZE)
          : loadLauncherPosition(
              getViewport(),
              LAUNCHER_SIZE,
              getDefaultPosition()
            )
        if (current) saveLauncherPosition(next)
        return next
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [])

  const closeDrawer = useCallback(() => {
    setIsOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }, [])

  const openDrawer = event => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      if (event.detail !== 0) return
    }

    if (!Drawer) {
      setDrawer(() =>
        dynamic(() => import('./KnowledgeGraphDrawer'), {
          ssr: false
        })
      )
    }

    setIsOpen(true)
  }

  const handlePointerDown = event => {
    if (event.button !== 0 || !position) return
    suppressClickRef.current = false
    pointerStateRef.current = {
      dragged: false,
      latestPosition: position,
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      positionStart: position
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = event => {
    const pointerState = pointerStateRef.current
    if (!pointerState || pointerState.pointerId !== event.pointerId) return

    const pointer = { x: event.clientX, y: event.clientY }
    if (!isLauncherDrag(pointerState.pointerStart, pointer)) return

    const nextPosition = clampLauncherPosition(
      {
        x:
          pointerState.positionStart.x +
          pointer.x -
          pointerState.pointerStart.x,
        y:
          pointerState.positionStart.y + pointer.y - pointerState.pointerStart.y
      },
      getViewport(),
      LAUNCHER_SIZE
    )
    pointerState.dragged = true
    pointerState.latestPosition = nextPosition
    suppressClickRef.current = true
    setPosition(nextPosition)
  }

  const finishPointerInteraction = event => {
    const pointerState = pointerStateRef.current
    if (!pointerState || pointerState.pointerId !== event.pointerId) return
    pointerStateRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (pointerState.dragged) {
      saveLauncherPosition(pointerState.latestPosition)
    }
  }

  const cancelPointerInteraction = event => {
    finishPointerInteraction(event)
    suppressClickRef.current = false
  }

  return (
    <>
      <button
        aria-label='知识图谱'
        className='fixed bottom-5 right-5 z-40 flex h-11 w-11 touch-none items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 shadow-lg transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-950'
        onClick={openDrawer}
        onPointerCancel={cancelPointerInteraction}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        ref={launcherRef}
        style={
          position
            ? {
                bottom: 'auto',
                left: position.x,
                right: 'auto',
                top: position.y
              }
            : undefined
        }
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
          allLinkPages={allLinkPages}
          depth={depth}
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
