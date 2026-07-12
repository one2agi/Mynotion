const KnowledgeGraphNodeDetails = ({
  onFocusNode,
  onOpenArticle,
  relatedNodes,
  selectedNode
}) => {
  if (!selectedNode) return null

  return (
    <section
      aria-label='所选知识节点'
      className='max-h-48 shrink-0 overflow-y-auto border-t border-gray-200 px-3 py-3 dark:border-gray-800'
    >
      <h3 className='break-words text-sm font-semibold'>
        {selectedNode.title}
      </h3>
      {relatedNodes.length > 0 ? (
        <ul className='mt-2 space-y-1' aria-label='相关文章'>
          {relatedNodes.map(node => (
            <li key={node.id}>
              <button
                className='w-full break-words rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                onClick={() => onFocusNode(node.id)}
                type='button'
              >
                {node.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
          暂无相关页面
        </p>
      )}
      <button
        className='mt-3 h-8 rounded bg-sky-600 px-3 text-xs font-medium text-white hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950'
        onClick={onOpenArticle}
        type='button'
      >
        打开文章
      </button>
    </section>
  )
}

export default KnowledgeGraphNodeDetails
