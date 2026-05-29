import { useUser } from '@clerk/nextjs'
import { useEffect } from 'react'

const ClerkUserBridge = ({ onChange }) => {
  const { isLoaded, isSignedIn, user } = useUser()

  useEffect(() => {
    onChange?.({ isLoaded, isSignedIn, user })
  }, [isLoaded, isSignedIn, onChange, user])

  return null
}

export default ClerkUserBridge
