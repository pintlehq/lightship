import { QueryClient } from '@tanstack/react-query'

/** Mock data never goes stale, so disable refetching/garbage churn. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})
