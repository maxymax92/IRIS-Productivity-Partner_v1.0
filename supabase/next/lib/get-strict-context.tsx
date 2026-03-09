import { createContext, useContext, type ReactNode, type JSX } from 'react'

function getStrictContext<T>(
  name?: string,
): readonly [(props: { value: T; children?: ReactNode }) => JSX.Element, () => T] {
  const Context = createContext<T | undefined>(undefined)

  function Provider({ value, children }: { value: T; children?: ReactNode }) {
    return <Context value={value}>{children}</Context>
  }

  function useSafeContext(): T {
    const ctx = useContext(Context)
    if (ctx === undefined) {
      throw new Error(`useContext must be used within ${name ?? 'a Provider'}`)
    }
    return ctx
  }

  return [Provider, useSafeContext] as const
}

export { getStrictContext }
