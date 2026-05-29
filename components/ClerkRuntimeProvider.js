import { zhCN } from '@clerk/localizations'
import { ClerkProvider } from '@clerk/nextjs'

const ClerkRuntimeProvider = ({ children }) => {
  return <ClerkProvider localization={zhCN}>{children}</ClerkProvider>
}

export default ClerkRuntimeProvider
