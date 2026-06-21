// __tests__/themes/starter/PayModal.test.js
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import PayModal from '@/themes/starter/components/PayModal'

// Mock next/navigation
const mockPush = jest.fn()
const mockRouter = { push: mockPush }
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter
}))

// Mock qrcode library
jest.mock('qrcode', () => ({
  toCanvas: jest.fn((canvas, text, opts) => {
    return Promise.resolve()
  })
}))

// Mock fetch
global.fetch = jest.fn()

describe('PayModal 组件', () => {
  const mockOnClose = jest.fn()
  const defaultProps = {
    visible: true,
    onClose: mockOnClose,
    pricingIndex: 1
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_THEME = 'starter'
  })

  describe('状态机渲染', () => {
    test('visible=true 时渲染弹窗', () => {
      render(<PayModal {...defaultProps} />)
      expect(screen.getByText('购买')).toBeInTheDocument()
    })

    test('visible=false 时不渲染', () => {
      render(<PayModal {...defaultProps} visible={false} />)
      expect(screen.queryByText('购买')).not.toBeInTheDocument()
    })

    test('默认状态为 FORM', () => {
      render(<PayModal {...defaultProps} />)
      expect(screen.getByPlaceholderText('请输入姓名')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('用于接收发货邮件')).toBeInTheDocument()
    })

    test('显示商品名称和价格', () => {
      render(<PayModal {...defaultProps} />)
      expect(screen.getByText('购买')).toBeInTheDocument()
    })
  })

  describe('表单交互', () => {
    test('填写表单字段', () => {
      render(<PayModal {...defaultProps} />)
      const nameInput = screen.getByPlaceholderText('请输入姓名')
      const emailInput = screen.getByPlaceholderText('用于接收发货邮件')

      fireEvent.change(nameInput, { target: { value: '张三' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

      expect(nameInput.value).toBe('张三')
      expect(emailInput.value).toBe('test@example.com')
    })

    test('优惠码为可选', () => {
      render(<PayModal {...defaultProps} />)
      const discountInput = screen.getByPlaceholderText('如有优惠码请输入')
      expect(discountInput).toBeInTheDocument()
    })
  })

  describe('关闭功能', () => {
    test('点击关闭按钮调用 onClose', () => {
      render(<PayModal {...defaultProps} />)
      const closeButton = screen.getByText('✕')
      fireEvent.click(closeButton)
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('轮询超时保护', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })
    afterEach(() => {
      jest.useRealTimers()
    })

    test('轮询超过 10 分钟自动停止并切 FAILED', async () => {
      // mock create-order 成功
      global.fetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            outTradeNo: 'TIMEOUT_TEST',
            qrcode: 'weixin://wxpay/bizpayurl?pr=xxx',
            amount: 0.1,
            originalAmount: 0.1,
            discountAmount: 0,
            productName: '测试商品'
          }
        })
      })
      // mock query-order 持续返回 pending
      global.fetch.mockResolvedValue({
        json: async () => ({
          success: true,
          data: { status: 'pending', outTradeNo: 'TIMEOUT_TEST' }
        })
      })

      render(<PayModal {...defaultProps} />)
      const nameInput = screen.getByPlaceholderText('请输入姓名')
      const emailInput = screen.getByPlaceholderText('用于接收发货邮件')
      fireEvent.change(nameInput, { target: { value: '张三' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

      const form = nameInput.closest('form')
      fireEvent.submit(form)

      // 等 handleSubmit 的 fetch + setStep 全部完成
      await act(async () => {
        await Promise.resolve()
      })

      // 推进 11 分钟（> 10 分钟超时阈值），
      // 使用 advanceTimersByTimeAsync 让 async setInterval 回调的微任务能 flush
      await act(async () => {
        await jest.advanceTimersByTimeAsync(11 * 60 * 1000)
      })

      // 此时应处于 FAILED 状态
      expect(await screen.findByText('支付超时，请重新创建订单')).toBeInTheDocument()
    })
  })
})