import { Suspense } from 'react'

import Hero33 from '@/components/blocks/hero/hero-33'
import { Canvas } from '@/components/canvas'
import { getCurrentUser } from '@/lib/auth/actions'

export default async function Home() {
  const result = await getCurrentUser()

  if (result.ok) {
    return <Canvas user={result.user} />
  }

  return (
    <Suspense>
      <Hero33 />
    </Suspense>
  )
}
