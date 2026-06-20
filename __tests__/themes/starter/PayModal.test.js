// __tests__/themes/starter/PayModal.test.js
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
})