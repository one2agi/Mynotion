import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/router'
import KnowledgeGraphCanvas from '@/components/KnowledgeGraph/KnowledgeGraphCanvas'
import KnowledgeGraphDrawer from '@/components/KnowledgeGraph/KnowledgeGraphDrawer'
import KnowledgeGraphLauncher from '@/components/KnowledgeGraph/KnowledgeGraphLauncher'
import { __pauseAnimation } from 'react-force-graph-2d'

jest.mock('next/router', () => ({
  useRouter: jest.fn()
}))

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
      <button
        aria-label='选择图谱节点'
        data-background-color={props.backgroundColor}
        data-node-count={props.graphData.nodes.length}
        onClick={() => props.onNodeClick?.(props.graphData.nodes[1])}
        type='button'
      />
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
  mockGraphResponse()
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
