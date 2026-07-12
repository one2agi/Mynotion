import { useState } from 'react'
import { GRAPH_SETTINGS_DEFAULTS, GRAPH_SETTINGS_RANGES } from './graphSettings'

const rangeControls = [
  ['labelOpacity', '文字透明度', 0.05],
  ['nodeSize', '节点大小', 1],
  ['linkWidth', '连线粗细', 0.25],
  ['centerStrength', '图谱向心力', 0.05],
  ['repelStrength', '节点间的排斥力', 5],
  ['linkStrength', '相连节点间的吸引力', 0.05],
  ['linkDistance', '连线长度', 5]
]

const segmentedButtonClass = active =>
  `h-8 flex-1 rounded px-2 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
    active
      ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
  }`

const RangeControl = ({ label, name, onChange, settings, step }) => (
  <label className='grid min-h-12 grid-cols-[1fr_auto] items-center gap-x-3 text-xs text-gray-700 dark:text-gray-300'>
    <span>{label}</span>
    <output className='w-10 text-right tabular-nums'>{settings[name]}</output>
    <input
      aria-label={label}
      className='col-span-2 h-6 w-full accent-sky-600'
      max={GRAPH_SETTINGS_RANGES[name][1]}
      min={GRAPH_SETTINGS_RANGES[name][0]}
      onChange={event =>
        onChange({ ...settings, [name]: Number(event.target.value) })
      }
      step={step}
      type='range'
      value={settings[name]}
    />
  </label>
)

const KnowledgeGraphSettingsPanel = ({
  onChange,
  onReset,
  settings = GRAPH_SETTINGS_DEFAULTS
}) => {
  const [open, setOpen] = useState(false)

  return (
    <section className='shrink-0 border-b border-gray-200 dark:border-gray-800'>
      <button
        aria-expanded={open}
        className='flex h-10 w-full items-center justify-between px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:text-gray-200 dark:hover:bg-gray-900'
        onClick={() => setOpen(value => !value)}
        type='button'
      >
        <span>设置知识图谱</span>
        <span aria-hidden='true'>{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className='max-h-[42vh] overflow-y-auto px-3 pb-3'>
          <details open>
            <summary className='cursor-pointer py-2 text-xs font-semibold'>
              外观
            </summary>
            <div className='space-y-2'>
              <div>
                <p className='mb-1 text-xs text-gray-600 dark:text-gray-400'>
                  局部深度
                </p>
                <div
                  className='flex h-8 gap-1'
                  role='group'
                  aria-label='局部深度'
                >
                  {[1, 2].map(value => (
                    <button
                      aria-pressed={settings.depth === value}
                      className={segmentedButtonClass(settings.depth === value)}
                      key={value}
                      onClick={() => onChange({ ...settings, depth: value })}
                      type='button'
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className='mb-1 text-xs text-gray-600 dark:text-gray-400'>
                  标签显示
                </p>
                <div
                  className='flex h-8 gap-1'
                  role='group'
                  aria-label='标签显示'
                >
                  {[
                    ['auto', '自动'],
                    ['always', '始终'],
                    ['never', '隐藏']
                  ].map(([value, label]) => (
                    <button
                      aria-pressed={settings.labelMode === value}
                      className={segmentedButtonClass(
                        settings.labelMode === value
                      )}
                      key={value}
                      onClick={() =>
                        onChange({ ...settings, labelMode: value })
                      }
                      type='button'
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {rangeControls.slice(0, 3).map(([name, label, step]) => (
                <RangeControl
                  key={name}
                  label={label}
                  name={name}
                  onChange={onChange}
                  settings={settings}
                  step={step}
                />
              ))}
            </div>
          </details>
          <details>
            <summary className='cursor-pointer py-2 text-xs font-semibold'>
              力度
            </summary>
            <div className='space-y-2'>
              {rangeControls.slice(3).map(([name, label, step]) => (
                <RangeControl
                  key={name}
                  label={label}
                  name={name}
                  onChange={onChange}
                  settings={settings}
                  step={step}
                />
              ))}
            </div>
          </details>
          <button
            className='mt-3 h-8 w-full rounded border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
            onClick={onReset}
            type='button'
          >
            重置知识图谱设置
          </button>
        </div>
      ) : null}
    </section>
  )
}

export default KnowledgeGraphSettingsPanel
