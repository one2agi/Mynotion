# Knowledge Graph Pointer And Pan Inertia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the complete visible node easy to drag and add bounded natural inertia to background panning.

**Architecture:** Use force-graph's invisible pointer-area callback for hit testing and retain its native dragging/panning. Track only the latest primary-pointer background pan velocity and apply a short viewport-center animation after release.

**Tech Stack:** React, react-force-graph-2d 1.29.0, Jest, requestAnimationFrame

## Global Constraints

- Pointer tolerance is fixed at 4 screen pixels at every zoom.
- Stationary time before release is fixed at 500 ms.
- Inertia duration is capped at 240 ms and displacement at 120 screen pixels.
- Node drag, reduced motion, new input, inactive state, and unmount suppress or cancel inertia.
- No settings, storage keys, dependencies, force reheating, or UI controls may be added.

---

### Task 1: Canvas Hit Area And Bounded Pan Inertia

**Files:**
- Modify: `components/KnowledgeGraph/KnowledgeGraphCanvas.js`
- Modify: `__tests__/components/KnowledgeGraphRendererContract.test.ts`
- Test if integration coverage is needed: `__tests__/components/KnowledgeGraph.test.js`

- [ ] **Step 1: Add failing renderer contract tests**

Assert `nodePointerAreaPaint` draws a circle with graph radius equal to rendered radius plus `4 / globalScale`, using the provided pointer color. Cover selected and ordinary node radii.

Use mocked pointer events, animation frames, `centerAt()` and `zoom()` to prove: quick background release moves the viewport in the release direction; stopping for 500 ms produces no motion; node dragging produces no inertia; movement follows a smooth ease-out trajectory and stops by 240 ms and 120 px; reduced motion and cancellation inputs stop it.

- [ ] **Step 2: Run RED**

```bash
pnpm test -- --runInBand __tests__/components/KnowledgeGraphRendererContract.test.ts
```

Expected: pointer-area and inertia props/behavior are absent.

- [ ] **Step 3: Implement fixed hit area and inertia**

Add named internal constants for 4 px tolerance, 500 ms idle cutoff, 240 ms duration, 120 px cap, and a 160 ms release-velocity projection window. Use one absolute cubic ease-out trajectory so frame timing cannot accumulate visible steps. Reuse the rendered radius calculation in `nodeCanvasObject` and `nodePointerAreaPaint` so visual and hit geometry cannot drift.

Track one pointer session. Mark it as node-driven from existing node drag callbacks. On qualifying background release, read the viewport center and zoom from the force-graph ref, convert screen velocity to graph coordinates, and advance via `requestAnimationFrame`. Cancel on pointer down, wheel, node drag, inactive state, reduced motion, and unmount. Do not reheat the simulation.

- [ ] **Step 4: Run GREEN and regression checks**

```bash
pnpm test -- --runInBand __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraph.test.js
pnpm type-check
pnpm exec prettier --check components/KnowledgeGraph/KnowledgeGraphCanvas.js __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraph.test.js
pnpm exec eslint components/KnowledgeGraph/KnowledgeGraphCanvas.js
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/KnowledgeGraph/KnowledgeGraphCanvas.js __tests__/components/KnowledgeGraphRendererContract.test.ts __tests__/components/KnowledgeGraph.test.js
git commit -m "fix(graph): improve pointer dragging and pan inertia"
```

Do not stage unrelated `.superpowers` changes.
