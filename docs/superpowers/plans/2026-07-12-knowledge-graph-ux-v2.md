# Knowledge Graph UX V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Fix false Notion relationships and deliver a calm, configurable 2D knowledge graph with outbound local neighborhoods, a draggable launcher, one-third-width drawer, and explicit node details.

**Architecture:** Keep the existing server-only Notion source, Blob publication flow, and react-force-graph-2d renderer. Restrict mention extraction to the requested page subtree, preserve outbound direction as compact edge origins, and keep all renderer preferences in versioned browser storage. Split data, renderer, and UI responsibilities so each can be tested independently.

**Tech Stack:** Next.js 14 Pages Router, React 18, TypeScript, Jest, Testing Library, react-force-graph-2d 1.29.1, EdgeOne Makers Functions, Tailwind CSS.

## Global Constraints

- Work only on local branch codex/knowledge-graph-ux-v2.
- Do not deploy, push, or merge unless the user later requests it.
- Keep the graph as Canvas 2D; do not add a graph or 3D dependency.
- Relation and inline page mentions render as identical ordinary lines without arrows.
- Preserve internal outbound direction for local traversal and node details.
- Desktop drawer width is clamp(360px, 33.333vw, 520px); mobile is full width.
- Renderer preferences use localStorage only and make no network or Blob writes.
- Respect prefers-reduced-motion and pause the simulation after stabilization.
- Use TDD for every behavioral change and commit each task independently.

---

## File Structure

### Data boundary

- Modify lib/knowledge-graph/types.ts: add requested page ID to extraction input and edge origin metadata.
- Modify lib/knowledge-graph/extract.ts: page-subtree scoping and outbound link extraction.
- Modify lib/knowledge-graph/refresh.ts: pass the requested page ID into extraction.
- Modify lib/knowledge-graph/build.ts: aggregate deterministic visual edges and outbound origins.
- Modify components/KnowledgeGraph/graphView.js: outbound local traversal and adjacency helpers.
- Create __tests__/fixtures/notion/knowledge-graph-page-scope.json: sanitized fixture based on the reproduced real Notion response.
- Modify focused data tests under __tests__/lib/knowledge-graph.

### Settings boundary

- Create components/KnowledgeGraph/graphSettings.js: defaults, ranges, normalization, storage, and reducer-style updates.
- Create __tests__/components/KnowledgeGraphSettings.test.js: pure settings and storage tests.

### Renderer boundary

- Create components/KnowledgeGraph/graphRenderModel.js: focus sets, colors, label policy, and reduced-motion defaults.
- Modify components/KnowledgeGraph/KnowledgeGraphCanvas.js: force configuration, calm motion, focus drawing, background selection, and drag safety.
- Modify renderer contract and scale tests.

### UI boundary

- Create components/KnowledgeGraph/launcherPosition.js: pointer threshold, viewport clamp, and persisted position.
- Create components/KnowledgeGraph/KnowledgeGraphSettingsPanel.js: compact Display and Forces controls.
- Create components/KnowledgeGraph/KnowledgeGraphNodeDetails.js: selected page and outbound related page list.
- Modify KnowledgeGraphLauncher.js, KnowledgeGraphDrawer.js, and ExternalPlugins.js.
- Modify __tests__/components/KnowledgeGraph.test.js and create launcher-position tests.

---

### Task 1: Scope Notion Link Extraction to the Requested Page

**Files:**
- Create: __tests__/fixtures/notion/knowledge-graph-page-scope.json
- Modify: lib/knowledge-graph/types.ts
- Modify: lib/knowledge-graph/extract.ts
- Modify: lib/knowledge-graph/refresh.ts
- Modify: __tests__/lib/knowledge-graph/extract.test.ts
- Modify: __tests__/lib/knowledge-graph/refresh.test.ts

**Interfaces:**
- Consumes: requested page ID, page root value, collection schema, and Notion record map.
- Produces: extractPageLinks({ pageId, pageValue, schema, recordMap }): string[] containing only normalized outbound links from the requested page.

- [ ] **Step 1: Add a sanitized real-shape page-scope fixture**

Create a fixture whose requested page has two valid targets and whose attached
foreign page contains two false targets:

~~~json
{
  "pageId": "39b4f4cfc8e280a986d9f6625a9d4f85",
  "validTargetIds": [
    "39b4f4cfc8e2803b86edc271c60647cf",
    "9c64f4cfc8e2823889d301928e594e80"
  ],
  "falseTargetIds": [
    "38b4f4cfc8e28093b5c5d1538840976c",
    "38b4f4cfc8e280bda864fa57d19ab138"
  ],
  "recordMap": {
    "block": {
      "39b4f4cfc8e280a986d9f6625a9d4f85": {
        "value": {
          "id": "39b4f4cf-c8e2-80a9-86d9-f6625a9d4f85",
          "properties": {}
        }
      },
      "00000000000000000000000000000010": {
        "value": {
          "id": "00000000-0000-0000-0000-000000000010",
          "parent_id": "39b4f4cf-c8e2-80a9-86d9-f6625a9d4f85",
          "properties": {
            "title": [["Local mention", [["p", "39b4f4cf-c8e2-803b-86ed-c271c60647cf"]]]]
          }
        }
      },
      "00000000000000000000000000000020": {
        "value": {
          "id": "00000000-0000-0000-0000-000000000020",
          "properties": {
            "title": [
              ["Attached mention", [["p", "38b4f4cf-c8e2-8093-b5c5-d1538840976c"]]],
              ["Attached relation", [["p", "38b4f4cf-c8e2-80bd-a864-fa57d19ab138"]]]
            ]
          }
        }
      }
    }
  }
}
~~~

- [ ] **Step 2: Write failing extraction tests**

Add tests proving that only the requested page subtree is scanned:

~~~ts
test('ignores mentions from attached foreign page records', () => {
  const result = extractPageLinks({
    pageId: scopeFixture.pageId,
    pageValue: {
      properties: {
        related: [
          ['Related', [['p', scopeFixture.validTargetIds[1]]]]
        ]
      }
    },
    schema: { related: { type: 'relation' } },
    recordMap: scopeFixture.recordMap
  })

  expect(result).toEqual([...scopeFixture.validTargetIds].sort())
  for (const falseTarget of scopeFixture.falseTargetIds) {
    expect(result).not.toContain(falseTarget)
  }
})
~~~

Add explicit nested-descendant and self-link assertions:

~~~ts
test('includes nested descendants and removes self links', () => {
  const recordMap = {
    block: {
      [scopeFixture.pageId]: {
        value: { id: scopeFixture.pageId, properties: {} }
      },
      '00000000000000000000000000000030': {
        value: {
          id: '00000000000000000000000000000030',
          parent_id: scopeFixture.pageId,
          properties: {}
        }
      },
      '00000000000000000000000000000031': {
        value: {
          id: '00000000000000000000000000000031',
          parent_id: '00000000000000000000000000000030',
          properties: {
            title: [
              ['Nested', [['p', scopeFixture.validTargetIds[0]]]],
              ['Self', [['p', scopeFixture.pageId]]]
            ]
          }
        }
      }
    }
  }

  expect(
    extractPageLinks({
      pageId: scopeFixture.pageId,
      pageValue: { properties: {} },
      schema: {},
      recordMap
    })
  ).toEqual([scopeFixture.validTargetIds[0]])
})
~~~

- [ ] **Step 3: Run the RED tests**

Run:

~~~bash
pnpm test -- __tests__/lib/knowledge-graph/extract.test.ts --runInBand
~~~

Expected: FAIL because ExtractPageLinksInput has no pageId and the foreign
record mention is included.

- [ ] **Step 4: Implement page-subtree scoping**

Extend the interface:

~~~ts
export interface ExtractPageLinksInput {
  pageId: string
  pageValue?: NotionPageValue
  schema?: NotionSchema
  recordMap?: NotionRecordMap
}

export interface NotionPageValue {
  id?: unknown
  parent_id?: unknown
  properties?: NotionProperties
}
~~~

Implement scoped record selection:

~~~ts
function blockBelongsToPage(
  block: NotionPageValue,
  pageId: string,
  blocks: Map<string, NotionPageValue>
): boolean {
  let current: NotionPageValue | undefined = block
  const visited = new Set<string>()

  while (current) {
    const currentId = normalizePageId(current.id)
    if (currentId === pageId) return true

    const parentId = normalizePageId(current.parent_id)
    if (!parentId || visited.has(parentId)) return false
    visited.add(parentId)
    current = blocks.get(parentId)
  }

  return false
}
~~~

Build the normalized block map once, scan only blocks for which
blockBelongsToPage returns true, merge root Relation links, remove pageId, and
sort the result.

- [ ] **Step 5: Pass pageId from refresh and test the contract**

Change refresh extraction:

~~~ts
links: extractPageLinks({
  pageId: page.id,
  pageValue: page.pageValue || pageValueFromRecordMap(recordMap, page.id),
  schema: page.schema || schemaFromRecordMap(recordMap),
  recordMap
})
~~~

Update refresh tests to expect pageId in the extraction path and retain cached
snapshot fallback behavior.

- [ ] **Step 6: Run focused GREEN tests**

Run:

~~~bash
pnpm test -- __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/refresh.test.ts --runInBand
~~~

Expected: both suites PASS and the reproduced page has exactly two targets.

- [ ] **Step 7: Commit**

~~~bash
git add lib/knowledge-graph/types.ts lib/knowledge-graph/extract.ts lib/knowledge-graph/refresh.ts __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/refresh.test.ts __tests__/fixtures/notion/knowledge-graph-page-scope.json
git commit -m "fix(graph): scope Notion links to current page"
~~~

---

### Task 2: Preserve Outbound Direction Without Drawing Arrows

**Files:**
- Modify: lib/knowledge-graph/types.ts
- Modify: lib/knowledge-graph/build.ts
- Modify: components/KnowledgeGraph/graphView.js
- Modify: __tests__/lib/knowledge-graph/build.test.ts

**Interfaces:**
- Consumes: PageSnapshot links as outbound targets from each page.
- Produces: GraphEdge { source, target, origins } and getOutboundNeighborIds(graph, nodeId).

- [ ] **Step 1: Write failing direction and mutual-link tests**

Add:

~~~ts
test('deduplicates visual edges while retaining outbound origins', () => {
  expect(
    buildPublicGraph(pages.slice(0, 3), {
      [pageIds.a]: { links: [pageIds.b] },
      [pageIds.b]: { links: [pageIds.a, pageIds.c] }
    }).edges
  ).toEqual([
    { source: pageIds.a, target: pageIds.b, origins: [pageIds.a, pageIds.b] },
    { source: pageIds.b, target: pageIds.c, origins: [pageIds.b] }
  ])
})

test('local depth follows outbound origins only', () => {
  const graph = buildPublicGraph(pages.slice(0, 3), {
    [pageIds.a]: { links: [] },
    [pageIds.b]: { links: [pageIds.a] },
    [pageIds.c]: { links: [pageIds.b] }
  })

  expect(selectGraphNeighborhood(graph, pageIds.a, 2)).toEqual({
    nodes: [pages[0]],
    edges: []
  })
})
~~~

- [ ] **Step 2: Run the RED test**

~~~bash
pnpm test -- __tests__/lib/knowledge-graph/build.test.ts --runInBand
~~~

Expected: FAIL because GraphEdge lacks origins and traversal is undirected.

- [ ] **Step 3: Add edge origins and deterministic aggregation**

~~~ts
export interface GraphEdge {
  source: string
  target: string
  origins?: string[]
}
~~~

In buildPublicGraph, retain sorted visual endpoints but add each page ID to
the edge origin set when its snapshot links to the other endpoint. Emit sorted
origins:

~~~ts
edges.set(key, {
  source,
  target: targetId,
  origins: Array.from(origins).sort()
})
~~~

- [ ] **Step 4: Add outbound graph helpers**

~~~js
export const edgeHasOutboundOrigin = (edge, nodeId) =>
  Array.isArray(edge.origins)
    ? edge.origins.includes(nodeId)
    : edge.source === nodeId || edge.target === nodeId

export const getOutboundNeighborIds = (graph, nodeId) => {
  const neighbors = new Set()
  for (const edge of graph.edges) {
    if (!edgeHasOutboundOrigin(edge, nodeId)) continue
    if (edge.source === nodeId) neighbors.add(edge.target)
    else if (edge.target === nodeId) neighbors.add(edge.source)
  }
  return neighbors
}
~~~

Use getOutboundNeighborIds in breadth-first local traversal. Filter final
edges to included nodes but preserve the full edge objects.

- [ ] **Step 5: Run focused GREEN tests**

~~~bash
pnpm test -- __tests__/lib/knowledge-graph/build.test.ts --runInBand
~~~

Expected: PASS, including compatibility behavior for old edges without
origins.

- [ ] **Step 6: Commit**

~~~bash
git add lib/knowledge-graph/types.ts lib/knowledge-graph/build.ts components/KnowledgeGraph/graphView.js __tests__/lib/knowledge-graph/build.test.ts
git commit -m "feat(graph): preserve outbound edge origins"
~~~

---

### Task 3: Add Client-Only Graph Settings

**Files:**
- Create: components/KnowledgeGraph/graphSettings.js
- Create: __tests__/components/KnowledgeGraphSettings.test.js

**Interfaces:**
- Produces: GRAPH_SETTINGS_DEFAULTS, GRAPH_SETTINGS_RANGES, normalizeGraphSettings, loadGraphSettings, saveGraphSettings, resetGraphSettings.
- Consumed later by KnowledgeGraphDrawer, KnowledgeGraphSettingsPanel, and KnowledgeGraphCanvas.

- [ ] **Step 1: Write failing normalization and storage tests**

~~~js
test('clamps persisted graph settings and rejects unknown label modes', () => {
  expect(
    normalizeGraphSettings({
      depth: 99,
      labelMode: 'invalid',
      nodeSize: -1,
      linkDistance: 999
    })
  ).toMatchObject({
    depth: 2,
    labelMode: 'auto',
    nodeSize: 3,
    linkDistance: 160
  })
})

test('round-trips one versioned localStorage payload', () => {
  saveGraphSettings({ ...GRAPH_SETTINGS_DEFAULTS, nodeSize: 7 })
  expect(loadGraphSettings().nodeSize).toBe(7)
  expect(fetch).not.toHaveBeenCalled()
})
~~~

- [ ] **Step 2: Run the RED test**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphSettings.test.js --runInBand
~~~

Expected: FAIL because graphSettings.js does not exist.

- [ ] **Step 3: Implement defaults and ranges**

~~~js
export const GRAPH_SETTINGS_STORAGE_KEY =
  'notionnext:knowledge-graph:settings:v1'

export const GRAPH_SETTINGS_DEFAULTS = Object.freeze({
  depth: 2,
  labelMode: 'auto',
  labelOpacity: 0.72,
  nodeSize: 5,
  linkWidth: 1,
  centerStrength: 0.35,
  repelStrength: 80,
  linkStrength: 0.25,
  linkDistance: 70
})

export const GRAPH_SETTINGS_RANGES = Object.freeze({
  depth: [1, 2],
  labelOpacity: [0.2, 1],
  nodeSize: [3, 9],
  linkWidth: [0.5, 3],
  centerStrength: [0, 1],
  repelStrength: [20, 200],
  linkStrength: [0.05, 1],
  linkDistance: [30, 160]
})
~~~

Use finite-number parsing and clamping. Catch storage and JSON errors and
return defaults without logging user data.

- [ ] **Step 4: Run GREEN tests**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphSettings.test.js --runInBand
~~~

Expected: PASS with no network calls.

- [ ] **Step 5: Commit**

~~~bash
git add components/KnowledgeGraph/graphSettings.js __tests__/components/KnowledgeGraphSettings.test.js
git commit -m "feat(graph): add local display settings"
~~~

---

### Task 4: Make the Canvas Calm, Focused, and Bounded

**Files:**
- Create: components/KnowledgeGraph/graphRenderModel.js
- Modify: components/KnowledgeGraph/KnowledgeGraphCanvas.js
- Modify: __tests__/components/KnowledgeGraphRendererContract.test.ts
- Modify: __tests__/components/KnowledgeGraphScale.test.js

**Interfaces:**
- Consumes: graph, selectedNodeId, currentId, settings, active, and callbacks.
- Produces: calm ForceGraph2D props, focus styling, labels, onBackgroundClick, and drag-safe onNodeClick.

- [ ] **Step 1: Write failing render-model and force-contract tests**

~~~js
test('focus model highlights only outbound neighbors', () => {
  const model = createGraphFocusModel(graph, 'a')
  expect(Array.from(model.focusedNodeIds)).toEqual(['a', 'b'])
  expect(model.focusedEdgeKeys).toEqual(new Set(['a:b']))
})

test('uses bounded calm 2d force props', () => {
  render(<KnowledgeGraphCanvas active graph={graph} settings={settings} />)
  expect(screen.getByRole('button', { name: '选择图谱节点' })).toHaveAttribute(
    'data-cooldown-ticks',
    '80'
  )
  expect(__forceGraphProps.minZoom).toBe(0.6)
  expect(__forceGraphProps.maxZoom).toBe(4)
})
~~~

Update the ForceGraph mock to expose force props, node drag callbacks,
background click, and zoom.

- [ ] **Step 2: Run RED renderer tests**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraphScale.test.js --runInBand
~~~

Expected: FAIL because focus model and settings-aware force props are missing.

- [ ] **Step 3: Implement pure focus and label policy**

~~~js
export const createGraphFocusModel = (graph, selectedNodeId) => {
  const outbound = selectedNodeId
    ? getOutboundNeighborIds(graph, selectedNodeId)
    : new Set()
  const focusedNodeIds = new Set(
    selectedNodeId ? [selectedNodeId, ...outbound] : []
  )
  const focusedEdgeKeys = new Set(
    graph.edges
      .filter(
        edge =>
          selectedNodeId &&
          edgeHasOutboundOrigin(edge, selectedNodeId) &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId)
      )
      .map(edge => [edge.source, edge.target].sort().join(':'))
  )
  return { focusedNodeIds, focusedEdgeKeys }
}
~~~

Add shouldDrawLabel({ mode, hovered, selected, zoom }) with Auto drawing
hovered/selected labels always and other labels only above the threshold.

- [ ] **Step 4: Configure calm forces and reduced motion**

Pass:

~~~jsx
<ForceGraph2D
  cooldownTicks={reducedMotion ? 1 : 80}
  d3AlphaDecay={reducedMotion ? 1 : 0.04}
  d3VelocityDecay={0.45}
  enableNodeDrag={true}
  minZoom={0.6}
  maxZoom={4}
/>
~~~

In an effect, configure charge strength as negative repelStrength, link
distance and strength, and center strength. Debounce graph reheating by 80ms,
and pause when inactive.

- [ ] **Step 5: Add drag safety and focus drawing**

Track whether onNodeDrag crossed the movement threshold. onNodeClick must
ignore the click after a drag. Draw selected nodes and outbound lines with the
accent color, reduce unrelated alpha, draw labels according to label policy,
and clear selection through onBackgroundClick.

~~~js
const draggedNodeRef = useRef(null)

const handleNodeDrag = node => {
  draggedNodeRef.current = node.id
}

const handleNodeClick = node => {
  if (draggedNodeRef.current === node.id) {
    draggedNodeRef.current = null
    return
  }
  onNodeClick?.(node)
}

const handleNodeDragEnd = () => {
  window.setTimeout(() => {
    draggedNodeRef.current = null
  }, 0)
}
~~~

- [ ] **Step 6: Run renderer GREEN tests**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraphScale.test.js --runInBand
~~~

Expected: PASS for 50-, 500-, and 1000-node fixtures, bounded zoom, reduced
motion, drag safety, and focus styling.

- [ ] **Step 7: Commit**

~~~bash
git add components/KnowledgeGraph/graphRenderModel.js components/KnowledgeGraph/KnowledgeGraphCanvas.js __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraphScale.test.js
git commit -m "feat(graph): refine calm 2d interaction"
~~~

---

### Task 5: Build the Draggable Launcher, Settings UI, and Node Details

**Files:**
- Create: components/KnowledgeGraph/launcherPosition.js
- Create: components/KnowledgeGraph/KnowledgeGraphSettingsPanel.js
- Create: components/KnowledgeGraph/KnowledgeGraphNodeDetails.js
- Create: __tests__/components/KnowledgeGraphLauncherPosition.test.js
- Modify: components/KnowledgeGraph/KnowledgeGraphLauncher.js
- Modify: components/KnowledgeGraph/KnowledgeGraphDrawer.js
- Modify: components/ExternalPlugins.js
- Modify: __tests__/components/KnowledgeGraph.test.js

**Interfaces:**
- Consumes: graph settings, getOutboundNeighborIds, Canvas callbacks, and allLinkPages.
- Produces: draggable launcher, one-third drawer, settings panel, selected-node details, focus switching, and explicit navigation.

- [ ] **Step 1: Write failing launcher utility tests**

~~~js
test('clamps launcher position inside viewport padding', () => {
  expect(
    clampLauncherPosition(
      { x: 999, y: -20 },
      { width: 320, height: 640 },
      { width: 44, height: 44 }
    )
  ).toEqual({ x: 264, y: 12 })
})

test('treats movement under five pixels as a click', () => {
  expect(isLauncherDrag({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false)
  expect(isLauncherDrag({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true)
})
~~~

- [ ] **Step 2: Write failing integrated UI tests**

Add tests that:

~~~jsx
render(
  <KnowledgeGraphDrawer
    allLinkPages={allLinkPages}
    isOpen
    onClose={jest.fn()}
    post={{ id: 'a' }}
  />
)
~~~

Then assert:

~~~js
expect(screen.getByTestId('knowledge-graph-panel-shell')).toHaveClass(
  'w-full',
  'sm:w-[clamp(360px,33.333vw,520px)]'
)
await user.click(screen.getByRole('button', { name: '设置知识图谱' }))
await user.clear(screen.getByRole('slider', { name: '节点大小' }))
fireEvent.change(screen.getByRole('slider', { name: '节点大小' }), {
  target: { value: '7' }
})
expect(fetch).toHaveBeenCalledTimes(1)

await user.click(screen.getByRole('button', { name: '选择图谱节点' }))
expect(screen.getByRole('heading', { name: 'Related article' })).toBeVisible()
await user.click(screen.getByRole('button', { name: '打开文章' }))
expect(router.push).toHaveBeenCalledWith('/canonical/related')

fireEvent.click(screen.getByTestId('knowledge-graph-canvas-background'))
expect(screen.queryByLabelText('所选知识节点')).not.toBeInTheDocument()
expect(router.push).toHaveBeenCalledTimes(1)
~~~

- [ ] **Step 3: Run RED UI tests**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphLauncherPosition.test.js __tests__/components/KnowledgeGraph.test.js --runInBand
~~~

Expected: FAIL because utilities, settings controls, details, and explicit
navigation are absent.

- [ ] **Step 4: Implement launcher position utilities**

~~~js
export const LAUNCHER_STORAGE_KEY =
  'notionnext:knowledge-graph:launcher-position:v1'
export const LAUNCHER_PADDING = 12
export const LAUNCHER_DRAG_THRESHOLD = 5

export const isLauncherDrag = (start, end) =>
  Math.hypot(end.x - start.x, end.y - start.y) >=
  LAUNCHER_DRAG_THRESHOLD
~~~

Implement clamp, safe load, and safe save. Use pointer capture in the launcher,
preserve keyboard click behavior, and suppress open only after a real drag.

- [ ] **Step 5: Implement compact settings and details components**

KnowledgeGraphSettingsPanel uses native range inputs, a segmented label-mode
control, depth 1/2 control, collapsible Display and Forces groups, and a Reset
button. Every input has an accessible label and stable dimensions.

~~~jsx
<label>
  节点大小
  <input
    aria-label='节点大小'
    max={GRAPH_SETTINGS_RANGES.nodeSize[1]}
    min={GRAPH_SETTINGS_RANGES.nodeSize[0]}
    onChange={event =>
      onChange({ ...settings, nodeSize: Number(event.target.value) })
    }
    step='1'
    type='range'
    value={settings.nodeSize}
  />
</label>
~~~

KnowledgeGraphNodeDetails receives selectedNode, relatedNodes, onFocusNode,
and onOpenArticle:

~~~jsx
<section aria-label='所选知识节点'>
  <h3>{selectedNode.title}</h3>
  <ul>
    {relatedNodes.map(node => (
      <li key={node.id}>
        <button type='button' onClick={() => onFocusNode(node.id)}>
          {node.title}
        </button>
      </li>
    ))}
  </ul>
  <button type='button' onClick={onOpenArticle}>打开文章</button>
</section>
~~~

- [ ] **Step 6: Integrate the drawer**

Load settings when the drawer mounts, save normalized changes, and pass them
to Canvas. Use settings.depth for local mode. Replace immediate node
navigation with selection, calculate outbound related nodes through
getOutboundNeighborIds, and keep canonical allLinkPages resolution only in
Open article.

Set the panel width:

~~~jsx
<div className='relative flex h-full w-full sm:w-[clamp(360px,33.333vw,520px)]'>
~~~

- [ ] **Step 7: Run UI GREEN tests**

~~~bash
pnpm test -- __tests__/components/KnowledgeGraphLauncherPosition.test.js __tests__/components/KnowledgeGraphSettings.test.js __tests__/components/KnowledgeGraph.test.js --runInBand
~~~

Expected: PASS for drag/click distinction, persistence, sizing, settings,
selection, related pages, explicit navigation, and background clearing.

- [ ] **Step 8: Commit**

~~~bash
git add components/KnowledgeGraph/launcherPosition.js components/KnowledgeGraph/KnowledgeGraphSettingsPanel.js components/KnowledgeGraph/KnowledgeGraphNodeDetails.js components/KnowledgeGraph/KnowledgeGraphLauncher.js components/KnowledgeGraph/KnowledgeGraphDrawer.js components/ExternalPlugins.js __tests__/components/KnowledgeGraphLauncherPosition.test.js __tests__/components/KnowledgeGraph.test.js
git commit -m "feat(graph): add configurable exploration panel"
~~~

---

### Task 6: Integration, Performance, and Local Acceptance

**Files:**
- Modify only files required by proven integration failures.
- Update: .superpowers/sdd/progress.md

**Interfaces:**
- Consumes all prior task outputs.
- Produces a locally verified release candidate with no production action.

- [ ] **Step 1: Run all focused suites**

~~~bash
pnpm test -- __tests__/lib/knowledge-graph __tests__/components/KnowledgeGraph.test.js __tests__/components/KnowledgeGraphSettings.test.js __tests__/components/KnowledgeGraphLauncherPosition.test.js __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraphScale.test.js __tests__/cloud-functions/knowledge-graph.test.ts __tests__/cloud-functions/knowledge-graph-bundle.test.ts --runInBand
~~~

Expected: all focused suites PASS.

- [ ] **Step 2: Run repository quality gates**

~~~bash
pnpm test -- --runInBand
pnpm type-check
pnpm lint
pnpm build
git diff --check main...HEAD
~~~

Expected: tests and build exit 0, type-check exits 0, lint has no new errors,
and diff check is clean.

- [ ] **Step 3: Verify the local EdgeOne function**

Keep EdgeOne makers dev local only and request:

~~~bash
curl -i http://127.0.0.1:8088/api/knowledge-graph
~~~

Expected: 200 JSON, the reproduced Bilibili node has exactly two outbound
neighbors, and every edge origins value contains only published page IDs.

- [ ] **Step 4: Verify desktop UI**

At 1440x900:

- launcher is visible and draggable;
- clicking without drag opens the drawer;
- drawer width is between 360 and 520 pixels and near one third viewport;
- settings update the canvas without network calls;
- node selection highlights outbound neighbors;
- details list matches the two valid reproduced relationships;
- Open article navigates through canonical href;
- no framework overlay or console error appears.

- [ ] **Step 5: Verify mobile UI**

At 390x844:

- drawer uses full width;
- controls and labels do not overflow;
- launcher remains clamped and usable by touch;
- graph is nonblank and settings remain accessible;
- no incoherent overlap appears.

- [ ] **Step 6: Commit integration-only fixes**

If verification required code changes, stage only those files and commit:

~~~bash
git commit -m "fix(graph): complete local ux integration"
~~~

If no integration changes are required, do not create an empty commit.

- [ ] **Step 7: Stop at the local acceptance gate**

Report:

- exact commits;
- focused and full test counts;
- build status;
- desktop/mobile screenshot paths;
- remaining risks;
- confirmation that no deploy, push, or merge occurred.
