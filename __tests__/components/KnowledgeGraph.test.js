import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/router'
import { siteConfig } from '@/lib/config'
import ExternalPlugin from '@/components/ExternalPlugins'
import KnowledgeGraphCanvas, {
  getCanvasDimensions
} from '@/components/KnowledgeGraph/KnowledgeGraphCanvas'
import KnowledgeGraphDrawer from '@/components/KnowledgeGraph/KnowledgeGraphDrawer'
import KnowledgeGraphLauncher from '@/components/KnowledgeGraph/KnowledgeGraphLauncher'
import { __pauseAnimation } from 'react-force-graph-2d'

jest.mock('next/router', () => ({
  useRouter: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn()
}))

jest.mock('@/lib/global', () => ({
  useGlobal: () => ({ lang: 'zh-CN' })
}))

jest.mock('@/lib/db/notion/convertInnerUrl', () => ({
  convertInnerUrl: jest.fn()
}))

jest.mock('@/components/GlobalStyle', () => ({
  GlobalStyle: () => null
}))

jest.mock('@/components/VConsole', () => () => null)

jest.mock('next/dynamic', () => {
  const React = require('react')

  return loader => {
    return function LazyComponent(props) {
      const [Component, setComponent] = React.useState(null)

      React.useEffect(() => {
        loader().then(module => setComponent(() => module.default))
      }, [])

      return Component ? <Component {...props} /> : null
    }
  }
})

jest.mock('react-force-graph-2d', () => {
  const React = require('react')
  const pauseAnimation = jest.fn()

  const ForceGraph2D = React.forwardRef(function ForceGraph2D(props, ref) {
    React.useImperativeHandle(ref, () => ({ pauseAnimation }))

    return (
      <>
        <button
          aria-label='选择图谱节点'
          data-background-color={props.backgroundColor}
          data-height={props.height}
          data-node-label={props.nodeLabel}
          data-node-count={props.graphData.nodes.length}
          data-width={props.width}
          onClick={() => props.onNodeClick?.(props.graphData.nodes[1])}
          tabIndex='-1'
          type='button'
        />
        <button
          aria-label='模拟渲染器变异'
          onClick={() => {
            props.graphData.nodes.pop()
            if (props.graphData.edges[0]) {
              props.graphData.edges[0].source = props.graphData.nodes[0]
            }
          }}
          tabIndex='-1'
          type='button'
        />
      </>
    )
  })

  return {
    __esModule: true,
    __pauseAnimation: pauseAnimation,
    default: ForceGraph2D
  }
})

const graph = {
  nodes: [
    { id: 'current', title: 'Current article', slug: '/current' },
    { id: 'related', title: 'Related article', slug: '/related' },
    { id: 'other', title: 'Other article', slug: '/other' }
  ],
  edges: [{ source: 'current', target: 'related' }]
}

const router = {
  push: jest.fn(),
  events: {
    on: jest.fn(),
    off: jest.fn()
  }
}

const mockGraphResponse = (body = graph, status = 200) => {
  fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

beforeEach(() => {
  useRouter.mockReturnValue(router)
  siteConfig.mockImplementation(key => key === 'CAN_COPY')
  mockGraphResponse()
})

test('does not mount a global launcher when the knowledge graph is disabled', async () => {
  render(<ExternalPlugin post={{ id: 'current', slug: '/current' }} />)

  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: '知识图谱' })
    ).not.toBeInTheDocument()
  })
})

test.each([
  ['article', { id: 'current', slug: '/current' }],
  ['non-article', undefined]
])('mounts one global launcher on a %s page when enabled', async (_, post) => {
  siteConfig.mockImplementation(
    key => key === 'KNOWLEDGE_GRAPH_ENABLE' || key === 'CAN_COPY'
  )

  render(<ExternalPlugin post={post} />)

  expect(
    await screen.findAllByRole('button', { name: '知识图谱' })
  ).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
})

test('loads the drawer only after its accessible launcher is activated', async () => {
  const user = userEvent.setup()
  render(<KnowledgeGraphLauncher post={{ id: 'current', slug: '/current' }} />)

  expect(screen.getByRole('button', { name: '知识图谱' })).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '知识图谱' }))

  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('closes the drawer with Escape and returns focus to its launcher', async () => {
  const user = userEvent.setup()
  render(<KnowledgeGraphLauncher post={{ id: 'current', slug: '/current' }} />)

  const launcher = screen.getByRole('button', { name: '知识图谱' })
  await user.click(launcher)
  await screen.findByRole('dialog')
  fireEvent.keyDown(document, { key: 'Escape' })

  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(launcher).toHaveFocus()
})

test('uses local mode for an article and can switch to full mode then return', async () => {
  const user = userEvent.setup()
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  await screen.findByRole('dialog')
  expect(
    screen.getByRole('button', { name: '查看当前文章关系' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-node-count', '2')

  await user.click(screen.getByRole('button', { name: '查看完整关系图' }))
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-node-count', '3')

  await user.click(screen.getByRole('button', { name: '返回当前文章关系' }))
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-node-count', '2')
})

test('keeps local neighbors after the renderer mutates full graph data', async () => {
  const user = userEvent.setup()
  mockGraphResponse({
    nodes: graph.nodes.map(node => ({ ...node })),
    edges: graph.edges.map(edge => ({ ...edge }))
  })
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: '查看完整关系图' }))
  await user.click(
    await screen.findByRole('button', { name: '模拟渲染器变异' })
  )
  await user.click(screen.getByRole('button', { name: '返回当前文章关系' }))

  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-node-count', '2')
})

test('uses full mode when there is no current article', async () => {
  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)

  await screen.findByRole('dialog')
  expect(
    screen.getByRole('button', { name: '查看完整关系图' })
  ).toHaveAttribute('aria-pressed', 'true')
})

test('closes with its close button and navigates when a graph node is selected', async () => {
  const user = userEvent.setup()
  const onClose = jest.fn()
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={onClose}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  await screen.findByRole('dialog')
  await user.click(await screen.findByRole('button', { name: '选择图谱节点' }))
  expect(router.push).toHaveBeenCalledWith('/related')

  await user.click(screen.getByRole('button', { name: '关闭知识图谱' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('explains initializing, unavailable, and empty-relationship responses', async () => {
  mockGraphResponse({ status: 'initializing' }, 202)
  const initializing = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )
  expect(await screen.findByText('知识图谱正在初始化')).toBeInTheDocument()
  initializing.unmount()

  mockGraphResponse(null, 503)
  const unavailable = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )
  expect(await screen.findByText('知识图谱暂不可用')).toBeInTheDocument()
  unavailable.unmount()

  mockGraphResponse({ nodes: [graph.nodes[0]], edges: [] })
  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)
  expect(await screen.findByText('暂无文章关系')).toBeInTheDocument()
})

test('shows an empty state when the local neighborhood has no relationships', async () => {
  mockGraphResponse({
    nodes: graph.nodes,
    edges: [{ source: 'related', target: 'other' }]
  })
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  expect(await screen.findByText('暂无文章关系')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '选择图谱节点' })
  ).not.toBeInTheDocument()
})

test('polls a bounded number of times while initialization remains open', async () => {
  jest.useFakeTimers()
  fetch.mockResolvedValue({
    ok: true,
    status: 202,
    json: async () => ({ status: 'initializing' })
  })
  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)

  await act(async () => {
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(1)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await act(async () => {
      jest.advanceTimersByTime(2_000)
      await Promise.resolve()
    })
  }
  expect(fetch).toHaveBeenCalledTimes(4)

  await act(async () => {
    jest.advanceTimersByTime(60_000)
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(4)

  jest.useRealTimers()
})

test('moves from initializing to ready with a cache-bypassing follow-up request', async () => {
  jest.useFakeTimers()
  fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ status: 'initializing' })
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => graph
    })
  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)

  await act(async () => {
    await Promise.resolve()
  })
  expect(await screen.findByText('知识图谱正在初始化')).toBeInTheDocument()

  await act(async () => {
    jest.advanceTimersByTime(2_000)
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(fetch).toHaveBeenNthCalledWith(2, '/api/knowledge-graph', {
    cache: 'no-store'
  })
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toBeInTheDocument()

  jest.useRealTimers()
})

test('cancels initializing polling when the drawer unmounts', async () => {
  jest.useFakeTimers()
  mockGraphResponse({ status: 'initializing' }, 202)
  const view = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )

  await act(async () => {
    await Promise.resolve()
  })
  view.unmount()
  await act(async () => {
    jest.advanceTimersByTime(60_000)
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(1)

  jest.useRealTimers()
})

test('traps Tab focus inside the drawer', async () => {
  const user = userEvent.setup()
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  const fullMode = screen.getByRole('button', { name: '查看完整关系图' })
  const panel = screen.getByTestId('knowledge-graph-panel')
  fullMode.focus()
  await user.tab()
  expect(panel).toContainElement(document.activeElement)

  await user.tab({ shift: true })
  expect(panel).toContainElement(document.activeElement)
})

test('pauses the canvas simulation when it is hidden', () => {
  const { rerender } = render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  rerender(
    <KnowledgeGraphCanvas active={false} currentId='current' graph={graph} />
  )
  expect(__pauseAnimation).toHaveBeenCalled()
})

test('pauses the canvas simulation when the drawer unmounts it', () => {
  const { unmount } = render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  unmount()
  expect(__pauseAnimation).toHaveBeenCalled()
})

test('uses the document dark-mode state when no dark-mode prop is supplied', () => {
  document.documentElement.classList.add('dark')
  const { unmount } = render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  expect(screen.getByRole('button', { name: '选择图谱节点' })).toHaveAttribute(
    'data-background-color',
    '#030712'
  )

  unmount()
  document.documentElement.classList.remove('dark')
})

test('uses the document dark-mode state for the drawer when no prop is supplied', async () => {
  document.documentElement.classList.add('dark')
  const view = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )

  await screen.findByRole('dialog')
  expect(screen.getByTestId('knowledge-graph-panel')).toHaveClass('bg-gray-950')

  view.unmount()
  document.documentElement.classList.remove('dark')
})

test('keeps measured canvas dimensions within short viewports', () => {
  expect(getCanvasDimensions({ height: 180, width: 320 })).toEqual({
    height: 180,
    width: 320
  })
})

test('keeps the complete title in the Canvas hover tooltip', () => {
  render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  expect(screen.getByRole('button', { name: '选择图谱节点' })).toHaveAttribute(
    'data-node-label',
    'title'
  )
})
