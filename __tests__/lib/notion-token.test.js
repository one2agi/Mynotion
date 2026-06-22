// __tests__/lib/notion-token.test.js

const mockNotionClient = {
  databases: { query: jest.fn() },
  pages: { update: jest.fn() }
}

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockReturnValue(mockNotionClient)
}))

beforeAll(async () => {
  jest.resetModules()
  await import('@/lib/notion-token') // 触发 import 让后续 require() 拿到 mock 后的版本
})

describe('lookupUnusedToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NOTION_TOKEN_DATABASE_ID = '3874f4cfc8e2807a99d8cf97f07cc0f5'
  })

  test('成功找到一个未使用的 token，返回 token 值和 pageId', async () => {
    const { lookupUnusedToken } = require('@/lib/notion-token')

    mockNotionClient.databases.query.mockResolvedValue({
      results: [{
        id: 'token-page-id-123',
        properties: {
          token: {
            rich_text: [{ plain_text: 'abcd1234efgh5678' }]
          },
          '已使用': { checkbox: false }
        }
      }]
    })

    const result = await lookupUnusedToken(mockNotionClient)
    expect(result).toEqual({ token: 'abcd1234efgh5678', pageId: 'token-page-id-123' })
    expect(mockNotionClient.databases.query).toHaveBeenCalledWith({
      database_id: '3874f4cfc8e2807a99d8cf97f07cc0f5',
      filter: {
        and: [
          { property: 'token', rich_text: { is_not_empty: true } },
          { property: '已使用', checkbox: { equals: false } }
        ]
      },
      page_size: 1
    })
  })

  test('没有可用的 token（已用完），返回 null', async () => {
    const { lookupUnusedToken } = require('@/lib/notion-token')

    mockNotionClient.databases.query.mockResolvedValue({ results: [] })

    const result = await lookupUnusedToken(mockNotionClient)
    expect(result).toBeNull()
  })

  test('token 字段为空，返回 null', async () => {
    const { lookupUnusedToken } = require('@/lib/notion-token')

    mockNotionClient.databases.query.mockResolvedValue({
      results: [{
        id: 'token-page-id-456',
        properties: {
          token: { rich_text: [] },
          '已使用': { checkbox: false }
        }
      }]
    })

    const result = await lookupUnusedToken(mockNotionClient)
    expect(result).toBeNull()
  })

  test('API 错误时不抛错，返回 null', async () => {
    const { lookupUnusedToken } = require('@/lib/notion-token')

    mockNotionClient.databases.query.mockRejectedValue(new Error('notion rate limit'))

    const result = await lookupUnusedToken(mockNotionClient)
    expect(result).toBeNull()
  })
})

describe('markTokenAsUsed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NOTION_TOKEN_DATABASE_ID = '3874f4cfc8e2807a99d8cf97f07cc0f5'
  })

  test('成功将 token 标为已使用，返回 true', async () => {
    const { markTokenAsUsed } = require('@/lib/notion-token')

    mockNotionClient.pages.update.mockResolvedValue({ id: 'token-page-id-123' })

    const result = await markTokenAsUsed('token-page-id-123', mockNotionClient)
    expect(result).toBe(true)
    expect(mockNotionClient.pages.update).toHaveBeenCalledWith({
      page_id: 'token-page-id-123',
      properties: {
        '已使用': { checkbox: true }
      }
    })
  })

  test('API 错误时不抛错，返回 false', async () => {
    const { markTokenAsUsed } = require('@/lib/notion-token')

    mockNotionClient.pages.update.mockRejectedValue(new Error('notion service unavailable'))

    const result = await markTokenAsUsed('token-page-id-456', mockNotionClient)
    expect(result).toBe(false)
  })
})
