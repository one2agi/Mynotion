import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/router'
import { siteConfig } from '@/lib/config'
import ExternalPlugin from '@/components/ExternalPlugins'
import KnowledgeGraphCanvas, {
  getCanvasDimensions
} from '@/components/KnowledgeGraph/KnowledgeGraphCanvas'
import KnowledgeGraphDrawer, {
  getInitializingPollDelay
} from '@/components/KnowledgeGraph/KnowledgeGraphDrawer'
import KnowledgeGraphLauncher from '@/components/KnowledgeGraph/KnowledgeGraphLauncher'
import { __pauseAnimation } from 'react-force-graph-2d'

jest.mock('notion-utils', () => ({
  idToUuid: id =>
    `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(
      16,
      20
    )}-${id.slice(20)}`
}))

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

    let firstNodeFill = ''
    const context = {
      arc: jest.fn(),
      beginPath: jest.fn(),
      fill: jest.fn(),
      set fillStyle(value) {
        if (!firstNodeFill) firstNodeFill = value
      }
    }
    if (props.graphData.nodes[0]) {
      props.nodeCanvasObject?.(props.graphData.nodes[0], context)
    }
    const firstNodeRadius = context.arc.mock.calls[0]?.[2]
    const renderedNodeRadii = props.graphData.nodes.map(node => {
      let radius
      const nodeContext = {
        arc: jest.fn((_x, _y, nextRadius) => {
          radius = nextRadius
        }),
        beginPath: jest.fn(),
        fill: jest.fn(),
        set fillStyle(_value) {}
      }
      props.nodeCanvasObject?.(node, nodeContext)
      return { id: node.id, radius }
    })
    const maxRadius = Math.max(
      ...renderedNodeRadii.map(node => node.radius ?? Number.NEGATIVE_INFINITY)
    )
    const nextRadius = Math.max(
      ...renderedNodeRadii
        .filter(node => node.radius !== maxRadius)
        .map(node => node.radius ?? Number.NEGATIVE_INFINITY)
    )
    const selectedNodeId =
      props.selectedNodeId ||
      (renderedNodeRadii.length > 1 && maxRadius - nextRadius >= 2
        ? renderedNodeRadii.find(node => node.radius === maxRadius)?.id
        : '')

    return (
      <>
        <button
          aria-label='选择图谱节点'
          data-background-color={props.backgroundColor}
          data-first-node-fill={firstNodeFill}
          data-height={props.height}
          data-has-node-label={String(
            Object.prototype.hasOwnProperty.call(props, 'nodeLabel')
          )}
          data-link-count={props.graphData.links.length}
          data-node-count={props.graphData.nodes.length}
          data-first-node-radius={firstNodeRadius}
          data-selected-node-id={selectedNodeId}
          data-width={props.width}
          onClick={() => props.onNodeClick?.(props.graphData.nodes[1])}
          onMouseEnter={() => props.onNodeHover?.(props.graphData.nodes[0])}
          onMouseLeave={() => props.onNodeHover?.(null)}
          tabIndex='-1'
          type='button'
        />
        <button
          aria-label='清除图谱选择'
          data-testid='knowledge-graph-canvas-background'
          onClick={() => props.onBackgroundClick?.()}
          tabIndex='-1'
          type='button'
        />
        <button
          aria-label='模拟渲染器变异'
          onClick={() => {
            props.graphData.nodes.pop()
            if (props.graphData.links[0]) {
              props.graphData.links[0].source = props.graphData.nodes[0]
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
    {
      id: 'current',
      title: 'Current article',
      slug: '/current',
      href: '/resolved/current.html'
    },
    {
      id: 'related',
      title: 'Related article',
      slug: '/wrong-related',
      href: '/resolved/related.html'
    },
    {
      id: 'other',
      title: 'Other article',
      slug: '/other',
      href: '/resolved/other.html'
    }
  ],
  edges: [{ source: 'current', target: 'related' }]
}

const depthGraph = {
  nodes: [
    {
      id: 'current',
      title: 'Current article',
      slug: '/current',
      href: '/current'
    },
    {
      id: 'related',
      title: 'Related article',
      slug: '/related',
      href: '/related'
    },
    {
      id: 'two-hop',
      title: 'Two-hop article',
      slug: '/two-hop',
      href: '/two-hop'
    }
  ],
  edges: [
    { source: 'current', target: 'related' },
    { source: 'related', target: 'two-hop' }
  ]
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
    json: () => Promise.resolve(body)
  })
}

beforeEach(() => {
  localStorage.clear()
  window.PointerEvent ||= MouseEvent
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

test.each([
  [0, 2],
  [1, 2],
  [2, 3],
  [3, 3]
])(
  'propagates configured depth %i through the shared launcher',
  async (depth, expectedNodes) => {
    const user = userEvent.setup()
    siteConfig.mockImplementation(key => {
      if (key === 'KNOWLEDGE_GRAPH_ENABLE' || key === 'CAN_COPY') return true
      if (key === 'KNOWLEDGE_GRAPH_DEPTH') return depth
      return false
    })
    mockGraphResponse(depthGraph)

    render(<ExternalPlugin post={{ id: 'current', slug: '/current' }} />)
    await user.click(await screen.findByRole('button', { name: '知识图谱' }))

    expect(
      await screen.findByRole('button', { name: '选择图谱节点' })
    ).toHaveAttribute('data-node-count', String(expectedNodes))
  }
)

test('loads the drawer only after its accessible launcher is activated', async () => {
  const user = userEvent.setup()
  render(<KnowledgeGraphLauncher post={{ id: 'current', slug: '/current' }} />)

  expect(screen.getByRole('button', { name: '知识图谱' })).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '知识图谱' }))

  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('persists a real launcher drag without opening the drawer', async () => {
  render(<KnowledgeGraphLauncher post={{ id: 'current', slug: '/current' }} />)

  const launcher = screen.getByRole('button', { name: '知识图谱' })
  await waitFor(() => expect(launcher.style.left).not.toBe(''))
  const startPosition = {
    x: Number.parseFloat(launcher.style.left),
    y: Number.parseFloat(launcher.style.top)
  }
  fireEvent.pointerDown(launcher, {
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 1
  })
  fireEvent.pointerMove(launcher, {
    clientX: 140,
    clientY: 130,
    pointerId: 1
  })
  fireEvent.pointerUp(launcher, { pointerId: 1 })
  fireEvent.click(launcher, { detail: 1 })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    JSON.parse(
      localStorage.getItem('notionnext:knowledge-graph:launcher-position:v1')
    )
  ).toEqual({
    x: Math.min(window.innerWidth - 56, startPosition.x + 40),
    y: Math.min(window.innerHeight - 56, startPosition.y + 30)
  })
})

test('does not let a cancelled launcher drag swallow the next click', async () => {
  render(<KnowledgeGraphLauncher post={{ id: 'current', slug: '/current' }} />)

  const launcher = screen.getByRole('button', { name: '知识图谱' })
  await waitFor(() => expect(launcher.style.left).not.toBe(''))
  fireEvent.pointerDown(launcher, {
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 1
  })
  fireEvent.pointerMove(launcher, {
    clientX: 140,
    clientY: 130,
    pointerId: 1
  })
  fireEvent.pointerCancel(launcher, { pointerId: 1 })
  fireEvent.click(launcher, { detail: 1 })

  expect(await screen.findByRole('dialog')).toBeInTheDocument()
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

test('shows settings and node details, then navigates only through the explicit action', async () => {
  const user = userEvent.setup()
  const onClose = jest.fn()
  const currentId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const relatedId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  mockGraphResponse({
    nodes: [
      { ...graph.nodes[0], id: currentId },
      { ...graph.nodes[1], id: relatedId }
    ],
    edges: [{ source: currentId, target: relatedId, origins: [currentId] }]
  })
  render(
    <KnowledgeGraphDrawer
      allLinkPages={[
        {
          id: relatedId,
          href: '/canonical/related'
        }
      ]}
      isOpen={true}
      onClose={onClose}
      post={{ id: currentId, slug: '/current' }}
    />
  )

  await screen.findByRole('dialog')
  expect(screen.getByTestId('knowledge-graph-panel-shell')).toHaveClass(
    'w-full',
    'sm:w-[clamp(360px,33.333vw,520px)]'
  )

  await user.click(screen.getByRole('button', { name: '设置知识图谱' }))
  fireEvent.change(screen.getByRole('slider', { name: '节点大小' }), {
    target: { value: '7' }
  })
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-first-node-radius', '9')
  expect(fetch).toHaveBeenCalledTimes(1)

  await user.click(await screen.findByRole('button', { name: '选择图谱节点' }))
  expect(screen.getByRole('heading', { name: 'Related article' })).toBeVisible()
  expect(router.push).not.toHaveBeenCalled()

  await user.selectOptions(
    screen.getByRole('combobox', { name: '选择图谱文章' }),
    currentId
  )
  await user.click(screen.getByRole('button', { name: 'Related article' }))
  expect(screen.getByRole('heading', { name: 'Related article' })).toBeVisible()
  expect(router.push).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '打开文章' }))
  expect(router.push).toHaveBeenCalledWith('/canonical/related')

  fireEvent.click(screen.getByTestId('knowledge-graph-canvas-background'))
  expect(screen.queryByLabelText('所选知识节点')).not.toBeInTheDocument()
  expect(router.push).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: '关闭知识图谱' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('uses the full graph for outbound details beyond the displayed local depth', async () => {
  const user = userEvent.setup()
  mockGraphResponse({
    ...depthGraph,
    edges: [
      { source: 'current', target: 'related', origins: ['current'] },
      { source: 'related', target: 'two-hop', origins: ['related'] }
    ]
  })
  render(
    <KnowledgeGraphDrawer
      depth={1}
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  const canvas = await screen.findByRole('button', {
    name: '选择图谱节点'
  })
  expect(canvas).toHaveAttribute('data-node-count', '2')

  await user.click(canvas)
  expect(screen.getByRole('heading', { name: 'Related article' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Two-hop article' }))
  expect(screen.getByRole('heading', { name: 'Two-hop article' })).toBeVisible()
})

test('keeps normalized session settings when localStorage writes fail', async () => {
  const user = userEvent.setup()
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: '设置知识图谱' }))
  fireEvent.change(screen.getByRole('slider', { name: '节点大小' }), {
    target: { value: '7' }
  })

  expect(screen.getByRole('slider', { name: '节点大小' })).toHaveValue('7')
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toHaveAttribute('data-first-node-radius', '9')
})

test('uses the canonical allLinkPages href through the global launcher', async () => {
  const user = userEvent.setup()
  const currentId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const relatedId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  siteConfig.mockImplementation(
    key => key === 'KNOWLEDGE_GRAPH_ENABLE' || key === 'CAN_COPY'
  )
  mockGraphResponse({
    nodes: [
      {
        id: currentId,
        title: 'Current article',
        slug: 'current',
        href: '/stale/current'
      },
      {
        id: relatedId,
        title: 'Related article',
        slug: 'related',
        href: '/stale/related'
      }
    ],
    edges: [{ source: currentId, target: relatedId }]
  })

  render(
    <ExternalPlugin
      allLinkPages={[
        {
          id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
          href: '/canonical/related'
        }
      ]}
      post={{ id: currentId, slug: 'current' }}
    />
  )

  await user.click(await screen.findByRole('button', { name: '知识图谱' }))
  await user.click(await screen.findByRole('button', { name: '选择图谱节点' }))
  await user.click(screen.getByRole('button', { name: '打开文章' }))

  expect(router.push).toHaveBeenCalledWith('/canonical/related')
})

test('uses the canonical href from shortened allLinkPages without a full id', async () => {
  const user = userEvent.setup()
  const currentId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const relatedId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  mockGraphResponse({
    nodes: [
      {
        id: currentId,
        title: 'Current article',
        slug: 'current',
        href: '/stale/current'
      },
      {
        id: relatedId,
        title: 'Related article',
        slug: 'related',
        href: '/stale/related'
      }
    ],
    edges: [{ source: currentId, target: relatedId }]
  })

  render(
    <KnowledgeGraphDrawer
      allLinkPages={[
        {
          short_id: 'bbbb-bbbb-bbbbbbbbbbbb',
          href: '/canonical/short-related'
        }
      ]}
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: currentId, slug: 'current' }}
    />
  )

  await user.click(await screen.findByRole('button', { name: '选择图谱节点' }))
  await user.click(screen.getByRole('button', { name: '打开文章' }))

  expect(router.push).toHaveBeenCalledWith('/canonical/short-related')
})

test('explains initializing, error, and empty-relationship responses', async () => {
  mockGraphResponse({ status: 'initializing' }, 202)
  const initializing = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )
  expect(await screen.findByText('知识图谱正在初始化')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '重试加载知识图谱' })
  ).not.toBeInTheDocument()
  initializing.unmount()

  mockGraphResponse(null, 503)
  const unavailable = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )
  expect(await screen.findByText('知识图谱暂不可用')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: '重试加载知识图谱' })
  ).toBeInTheDocument()
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

test('uses capped initialization backoff delays', () => {
  expect([0, 1, 2, 3, 4, 20].map(getInitializingPollDelay)).toEqual([
    2_000, 4_000, 8_000, 10_000, 10_000, 10_000
  ])
})

test('keeps polling beyond six seconds and becomes ready when initialization completes', async () => {
  jest.useFakeTimers()
  const openedAt = Date.now()
  fetch.mockImplementation(() => {
    if (Date.now() - openedAt <= 6_000) {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({ status: 'initializing' })
      })
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(graph)
    })
  })
  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)

  await act(async () => {
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(1)

  await act(async () => {
    jest.advanceTimersByTime(2_000)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    jest.advanceTimersByTime(4_000)
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(screen.getByText('知识图谱正在初始化')).toBeInTheDocument()

  await act(async () => {
    jest.advanceTimersByTime(8_000)
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(
    await screen.findByRole('button', { name: '选择图谱节点' })
  ).toBeInTheDocument()

  jest.useRealTimers()
})

test('moves from initializing to ready with a cache-bypassing follow-up request', async () => {
  jest.useFakeTimers()
  fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ status: 'initializing' })
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(graph)
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

test('cancels initializing polling when the drawer closes without unmounting', async () => {
  jest.useFakeTimers()
  mockGraphResponse({ status: 'initializing' }, 202)
  const view = render(
    <KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />
  )

  await act(async () => {
    await Promise.resolve()
  })
  view.rerender(<KnowledgeGraphDrawer isOpen={false} onClose={jest.fn()} />)
  view.unmount()
  await act(async () => {
    jest.advanceTimersByTime(60_000)
    await Promise.resolve()
  })
  expect(fetch).toHaveBeenCalledTimes(1)

  jest.useRealTimers()
})

test('retries only after an actual load error and then recovers', async () => {
  const user = userEvent.setup()
  fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve(null)
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(graph)
    })

  render(<KnowledgeGraphDrawer isOpen={true} onClose={jest.fn()} />)

  expect(await screen.findByText('知识图谱暂不可用')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试加载知识图谱' }))

  expect(
    await screen.findByRole('combobox', { name: '选择图谱文章' })
  ).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('provides native keyboard navigation synchronized with the displayed graph', async () => {
  const user = userEvent.setup()
  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: 'current', slug: '/current' }}
    />
  )

  const select = await screen.findByRole('combobox', {
    name: '选择图谱文章'
  })
  expect(
    screen.getAllByRole('option').map(option => option.textContent)
  ).toEqual(['Current article', 'Related article'])

  await user.selectOptions(select, 'related')
  await user.click(screen.getByRole('button', { name: '打开文章' }))

  expect(router.push).toHaveBeenCalledWith('/resolved/related.html')
})

test('normalizes an uppercase hyphenated current article ID for local selection and highlighting', async () => {
  const canonicalCurrent = 'abcdefabcdefabcdefabcdefabcdef01'
  const canonicalRelated = '00000000000000000000000000000002'
  mockGraphResponse({
    nodes: [
      {
        id: canonicalCurrent,
        title: 'Current article',
        slug: 'current',
        href: '/current'
      },
      {
        id: canonicalRelated,
        title: 'Related article',
        slug: 'related',
        href: '/related'
      },
      {
        id: '00000000000000000000000000000003',
        title: 'Other article',
        slug: 'other',
        href: '/other'
      }
    ],
    edges: [{ source: canonicalCurrent, target: canonicalRelated }]
  })

  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{
        id: 'ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEF01',
        slug: '/current'
      }}
    />
  )

  const canvas = await screen.findByRole('button', { name: '选择图谱节点' })
  expect(canvas).toHaveAttribute('data-node-count', '2')
  expect(canvas).toHaveAttribute('data-first-node-fill', '#0284c7')
})

test('focuses the current article when graph data arrives after opening', async () => {
  const currentId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const relatedId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  let resolveGraph
  fetch.mockImplementation(
    () =>
      new Promise(resolve => {
        resolveGraph = resolve
      })
  )

  render(
    <KnowledgeGraphDrawer
      isOpen={true}
      onClose={jest.fn()}
      post={{ id: currentId, slug: '/current' }}
    />
  )

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

  await act(async () => {
    resolveGraph({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          nodes: [
            { id: currentId, title: 'Current article' },
            { id: relatedId, title: 'Related article' }
          ],
          edges: [
            { source: currentId, target: relatedId, origins: [currentId] }
          ]
        })
    })
    await Promise.resolve()
    await Promise.resolve()
  })

  await waitFor(() => {
    expect(document.querySelector('[data-node-count]')).toHaveAttribute(
      'data-selected-node-id',
      currentId
    )
  })
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

test('renders long hostile titles literally below a top-edge pointer within bounded tooltip space', () => {
  const hostileTitle = `${'<img src=x onerror="window.__xss = true"> '.repeat(
    32
  )}Long hostile title`
  render(
    <KnowledgeGraphCanvas
      active={true}
      currentId='current'
      graph={{
        ...graph,
        nodes: [
          { ...graph.nodes[0], title: hostileTitle },
          ...graph.nodes.slice(1)
        ]
      }}
    />
  )

  const canvas = screen.getByRole('button', { name: '选择图谱节点' })
  jest.spyOn(canvas.parentElement, 'getBoundingClientRect').mockReturnValue({
    height: 180,
    left: 0,
    top: 0,
    width: 320
  })
  fireEvent.mouseMove(canvas, { clientX: 24, clientY: 16 })
  fireEvent.mouseEnter(canvas)

  const tooltip = screen.getByTestId('knowledge-graph-tooltip')
  expect(tooltip).toHaveTextContent(hostileTitle)
  expect(tooltip).toHaveStyle({
    left: '24px',
    maxHeight: '156px',
    top: '16px',
    transform: 'translate(0%, 0%)'
  })
  expect(tooltip).toHaveClass('max-w-[calc(100%-1rem)]', 'overflow-auto')
  expect(tooltip.querySelector('img')).toBeNull()
  expect(window.__xss).toBeUndefined()
})

test('does not pass nodeLabel to the Canvas renderer', () => {
  render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  expect(document.querySelector('[data-node-count]')).toHaveAttribute(
    'data-has-node-label',
    'false'
  )
})

test('clears the Canvas tooltip when its container receives pointer leave', () => {
  render(
    <KnowledgeGraphCanvas active={true} currentId='current' graph={graph} />
  )

  const canvas = document.querySelector('[data-node-count]')
  fireEvent.mouseEnter(canvas)
  expect(screen.getByTestId('knowledge-graph-tooltip')).toBeInTheDocument()

  fireEvent.pointerLeave(canvas.parentElement)
  expect(
    screen.queryByTestId('knowledge-graph-tooltip')
  ).not.toBeInTheDocument()
})
