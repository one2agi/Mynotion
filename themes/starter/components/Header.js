/* eslint-disable no-unreachable */
import { starterConfig } from '../config'
import { useGlobal } from '@/lib/global'
import throttle from 'lodash.throttle'
import SmartLink from '@/components/SmartLink'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'
import { DarkModeButton } from './DarkModeButton'
import { Logo } from './Logo'
import { MenuList } from './MenuList'

/**
 * 顶部导航栏
 */
export const Header = props => {
  const router = useRouter()
  const { isDarkMode } = useGlobal()
  const [buttonTextColor, setColor] = useState(
    router.route === '/' ? 'text-white' : ''
  )

  const navButton1Text = starterConfig('STARTER_NAV_BUTTON_1_TEXT', '')
  const navButton1Url = starterConfig('STARTER_NAV_BUTTON_1_URL', '')
  const navButton2Text = starterConfig('STARTER_NAV_BUTTON_2_TEXT', '')
  const navButton2Url = starterConfig('STARTER_NAV_BUTTON_2_URL', '')

  useEffect(() => {
    if (isDarkMode || router.route === '/') {
      setColor('text-white')
    } else {
      setColor('')
    }
    // ======= Sticky
    window.addEventListener('scroll', navBarScollListener, { passive: true })
    return () => {
      window.removeEventListener('scroll', navBarScollListener)
    }
  }, [isDarkMode])

  // 滚动监听
  const throttleMs = 200
  const navBarScollListener = useCallback(
    throttle(() => {
      // eslint-disable-next-line camelcase
      const ud_header = document.querySelector('.ud-header')
      const scrollY = window.scrollY
      // 控制台输出当前滚动位置和 sticky 值
      if (scrollY > 0) {
        ud_header?.classList?.add('sticky')
      } else {
        ud_header?.classList?.remove('sticky')
      }
    }, throttleMs)
  )

  return (
    <>
      {/* <!-- ====== Navbar Section Start --> */}
      <div className='ud-header absolute left-0 top-0 z-40 flex w-full items-center bg-transparent'>
        <div className='container'>
          <div className='relative -mx-4 flex items-center justify-between'>
            {/* Logo */}
            <Logo {...props} />

            <div className='flex w-full items-center justify-between px-4'>
              {/* 中间菜单 */}
              <MenuList {...props} />

              {/* 右侧功能 */}
              <div className='flex items-center gap-4 justify-end pr-16 lg:pr-0'>
                {/* 深色模式切换 */}
                <DarkModeButton />
                {/* 可选的通用导航按钮 */}
                {((navButton1Text && navButton1Url) ||
                  (navButton2Text && navButton2Url)) && (
                  <div className='hidden sm:flex gap-4'>
                    {navButton1Text && navButton1Url && (
                      <SmartLink
                        href={navButton1Url}
                        className={`loginBtn ${buttonTextColor} p-2 text-base font-medium hover:opacity-70`}>
                        {navButton1Text}
                      </SmartLink>
                    )}
                    {navButton2Text && navButton2Url && (
                      <SmartLink
                        href={navButton2Url}
                        className={`signUpBtn ${buttonTextColor} p-2 rounded-md bg-white bg-opacity-20 py-2 text-base font-medium duration-300 ease-in-out hover:bg-opacity-100 hover:text-dark`}>
                        {navButton2Text}
                      </SmartLink>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* <!-- ====== Navbar Section End --> */}
    </>
  )
}
