import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { resolvePostProps } from '@/lib/db/SiteDataApi'
import { DynamicLayout } from '@/themes/theme'
import PropTypes from 'prop-types'

/**
 * 根据notion的slug访问页面
 * 只解析一级目录例如 /about
 * @param {*} props
 * @returns
 */
const Dashboard = props => {
  const theme = siteConfig('THEME', BLOG.THEME, props?.NOTION_CONFIG)

  Dashboard.propTypes = {
    NOTION_CONFIG: PropTypes.object
  }
  return <DynamicLayout theme={theme} layoutName='LayoutDashboard' {...props} />
}

// SSR (was getStaticProps + getStaticPaths) — required so the
// /_next/data/{buildId}/zh-CN/dashboard.json data endpoint is generated at
// request time. With rewrites for locale stripping (next.config.js), Next.js
// does not generate data files for rewritten source paths — converting to
// getServerSideProps skips that lookup and fixes the client-side router's
// prefetch 404 (which previously forced full page reloads).
//
// getStaticPaths is removed entirely (incompatible with getServerSideProps).
// All dashboard sub-routes (membership, balance, user-profile, order,
// affiliate, and the dashboard root) are now resolved at request time —
// Next.js will SSR any previously enumerated path on first hit.
export async function getServerSideProps({ locale }) {
  const prefix = 'dashboard'
  const props = await resolvePostProps({
    prefix,
    locale
  })

  return { props }
}

export default Dashboard
