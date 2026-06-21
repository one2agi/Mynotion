// themes/starter/components/PayModal.js
'use client'

import { useState, useEffect, useRef } from 'react'
import { siteConfig } from '@/lib/config'
import QRCode from 'qrcode'

// 轮询最大持续时间：10 分钟（覆盖正常扫码 + 输密码时间）
const MAX_POLL_DURATION = 10 * 60 * 1000
// 轮询间隔：3 秒
const POLL_INTERVAL = 3000
// 页面隐藏超过此时间，回来时主动查一次（避免后台 throttle 导致状态延迟）
const HIDDEN_RESYNC_THRESHOLD = 60 * 1000

// productId → pricingIndex（与 server-side PRODUCT_MAP 保持一致）
const PRODUCT_TO_INDEX = {
  'starter-basic': 1,
  'starter-pro': 2,
  'starter-premium': 3
}

/**
 * 支付弹窗组件
 * 状态机：CLOSED → FORM → LOADING → QR_CODE → POLLING → SUCCESS | FAILED
 * @param {Object} props
 * @param {boolean} props.visible - 控制弹窗显示/隐藏
 * @param {Function} props.onClose - 关闭弹窗回调
 * @param {string} props.productId - 商品 ID（'starter-basic' | 'starter-pro' | 'starter-premium'）
 */
export default function PayModal({ visible, onClose, productId }) {
  const [step, setStep] = useState('FORM')
  const [productName, setProductName] = useState('')
  const [price, setPrice] = useState(0)
  const [formData, setFormData] = useState({ name: '', email: '', discountCode: '' })
  const [orderInfo, setOrderInfo] = useState(null)
  const [error, setError] = useState('')
  const [qrcodeUrl, setQrcodeUrl] = useState('')
  const canvasRef = useRef(null)
  const pollingTimerRef = useRef(null)
  const pollingStartTimeRef = useRef(null)
  const currentOutTradeNoRef = useRef(null)
  const hiddenSinceRef = useRef(null)

  // 根据 productId 加载商品信息
  useEffect(() => {
    if (visible && productId) {
      const index = PRODUCT_TO_INDEX[productId]
      if (!index) return
      const name = siteConfig(`STARTER_PRICING_${index}_TITLE`)
      const priceVal = parseFloat(siteConfig(`STARTER_PRICING_${index}_PRICE`, '0'))
      setProductName(name || '')
      setPrice(priceVal || 0)
    }
  }, [visible, productId])

  // 清理轮询定时器 + visibility 监听
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 页面隐藏，记录隐藏时间
        hiddenSinceRef.current = Date.now()
      } else if (hiddenSinceRef.current && currentOutTradeNoRef.current) {
        // 页面恢复，如果隐藏超过阈值则主动查一次
        const hiddenDuration = Date.now() - hiddenSinceRef.current
        hiddenSinceRef.current = null
        if (hiddenDuration > HIDDEN_RESYNC_THRESHOLD) {
          // 立即触发一次轮询（不等下个 interval tick）
          checkOrderStatus(currentOutTradeNoRef.current)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearPollingState()
    }
  }, [])

  // 渲染二维码
  useEffect(() => {
    if (qrcodeUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrcodeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      })
    }
  }, [qrcodeUrl])

  /**
   * 清理轮询相关的 ref（interval + startTime + outTradeNo）。
   * 单一来源：handleClose、unmount effect、stopPolling 都调它，
   * 避免 4 个 ref 各自手动 clear 导致漏改。
   */
  const clearPollingState = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }
    pollingStartTimeRef.current = null
    currentOutTradeNoRef.current = null
  }

  /**
   * 查询一次订单状态，根据返回切到 SUCCESS / FAILED。
   * pollOnce 与 setInterval 回调都调它，避免重复 fetch + 重复判断。
   * @param {string} outTradeNo
   */
  const checkOrderStatus = async (outTradeNo) => {
    try {
      const resp = await fetch(`/api/pay/query-order?outTradeNo=${outTradeNo}`)
      const json = await resp.json()
      if (json.data?.status === 'paid') {
        stopPolling('SUCCESS', null)
      } else if (json.data?.status === 'closed') {
        stopPolling('FAILED', '订单已超时关闭，请重新购买')
      }
    } catch (err) {
      // 网络抖动：忽略，下次 interval tick 再查
    }
  }

  /**
   * 停止轮询并切状态
   * @param {string} nextStep - 'SUCCESS' | 'FAILED'
   * @param {string|null} errMsg
   */
  const stopPolling = (nextStep, errMsg) => {
    clearPollingState()
    if (errMsg) setError(errMsg)
    setStep(nextStep)
  }

  /**
   * 提交表单创建订单
   * @param {React.FormEvent} e - 表单提交事件
   */
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setStep('LOADING')

    try {
      const resp = await fetch('/api/pay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, productId })
      })

      const json = await resp.json()

      if (!json.success) {
        setError(json.error || '订单创建失败')
        setStep('FAILED')
        return
      }

      setOrderInfo(json.data)
      setQrcodeUrl(json.data.qrcode)
      setStep('QR_CODE')

      // 开始轮询
      startPolling(json.data.outTradeNo)
    } catch (err) {
      setError('网络错误，请重试')
      setStep('FAILED')
    }
  }

  /**
   * 开始轮询订单状态（带超时保护）
   * @param {string} outTradeNo - 订单号
   */
  const startPolling = (outTradeNo) => {
    setStep('POLLING')
    pollingStartTimeRef.current = Date.now()
    currentOutTradeNoRef.current = outTradeNo
    pollingTimerRef.current = setInterval(async () => {
      // 超时检查：避免用户关 tab 离开后无限轮询
      if (Date.now() - pollingStartTimeRef.current > MAX_POLL_DURATION) {
        stopPolling('FAILED', '支付超时，请重新创建订单')
        return
      }
      await checkOrderStatus(outTradeNo)
    }, POLL_INTERVAL)
  }

  /**
   * 关闭弹窗并重置状态
   */
  const handleClose = () => {
    clearPollingState()
    setStep('FORM')
    setFormData({ name: '', email: '', discountCode: '' })
    setOrderInfo(null)
    setError('')
    setQrcodeUrl('')
    onClose()
  }

  if (!visible) return null

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl'>
        <button
          onClick={handleClose}
          className='absolute right-4 top-4 text-gray-400 hover:text-gray-600'
        >
          ✕
        </button>

        <h3 className='mb-4 text-xl font-semibold text-dark'>购买 {productName}</h3>

        {/* FORM 状态 */}
        {step === 'FORM' && (
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div>
              <label className='block text-sm font-medium text-gray-700'>姓名</label>
              <input
                type='text'
                required
                maxLength={50}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className='mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none'
                placeholder='请输入姓名'
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700'>电子邮箱</label>
              <input
                type='email'
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className='mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none'
                placeholder='用于接收发货邮件'
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700'>优惠码（可选）</label>
              <input
                type='text'
                value={formData.discountCode}
                onChange={(e) => setFormData({ ...formData, discountCode: e.target.value })}
                className='mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none'
                placeholder='如有优惠码请输入'
              />
            </div>
            <div className='rounded-md bg-gray-50 p-3 text-sm'>
              <div className='flex justify-between'>
                <span className='text-gray-600'>商品</span>
                <span className='font-medium'>{productName}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-600'>原价</span>
                <span className='font-medium'>¥{price.toFixed(2)}</span>
              </div>
            </div>
            <button
              type='submit'
              className='w-full rounded-md bg-primary py-3 text-center text-base font-medium text-white hover:bg-blue-dark'
            >
              确认支付 ¥{price.toFixed(2)}
            </button>
          </form>
        )}

        {/* LOADING 状态 */}
        {step === 'LOADING' && (
          <div className='py-8 text-center'>
            <div className='mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent'></div>
            <p className='mt-4 text-gray-600'>验证中...</p>
          </div>
        )}

        {/* QR_CODE / POLLING 状态 */}
        {(step === 'QR_CODE' || step === 'POLLING') && (
          <div className='text-center'>
            <canvas ref={canvasRef} className='mx-auto'></canvas>
            <p className='mt-4 text-sm text-gray-600'>请使用微信扫码支付</p>
            {orderInfo && (
              <div className='mt-2 rounded-md bg-gray-50 p-3 text-sm'>
                <div className='flex justify-between'>
                  <span className='text-gray-600'>订单号</span>
                  <span className='font-mono text-xs'>{orderInfo.outTradeNo}</span>
                </div>
                {orderInfo.originalAmount !== orderInfo.amount && (
                  <>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>原价</span>
                      <span>¥{orderInfo.originalAmount.toFixed(2)}</span>
                    </div>
                    <div className='flex justify-between text-green-600'>
                      <span>折扣</span>
                      <span>-¥{orderInfo.discountAmount.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className='flex justify-between font-semibold'>
                  <span>实付</span>
                  <span className='text-primary'>¥{orderInfo.amount.toFixed(2)}</span>
                </div>
              </div>
            )}
            {step === 'POLLING' && (
              <p className='mt-3 text-sm text-gray-500'>等待支付中...</p>
            )}
          </div>
        )}

        {/* SUCCESS 状态 */}
        {step === 'SUCCESS' && (
          <div className='py-6 text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100'>
              <span className='text-3xl'>✅</span>
            </div>
            <h4 className='text-lg font-semibold text-green-600'>支付成功</h4>
            <p className='mt-2 text-sm text-gray-600'>
              邮件5分钟内发送，请注意查收<br />
              可添加QQ群：1001627468
            </p>
            <button
              onClick={handleClose}
              className='mt-4 w-full rounded-md bg-green-600 py-3 text-center text-base font-medium text-white hover:bg-green-700'
            >
              确认关闭
            </button>
          </div>
        )}

        {/* FAILED 状态 */}
        {step === 'FAILED' && (
          <div className='py-6 text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100'>
              <span className='text-3xl'>❌</span>
            </div>
            <p className='text-sm text-red-600'>{error}</p>
            <button
              onClick={() => setStep('FORM')}
              className='mt-4 w-full rounded-md bg-primary py-3 text-center text-base font-medium text-white hover:bg-blue-dark'
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}