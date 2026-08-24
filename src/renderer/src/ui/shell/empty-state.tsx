export function EmptyState({ hint = '⌘K to search' }: { hint?: string }) {
  return (
    <div className="grid h-full place-items-center font-mono text-sm text-dim">
      No tab open · {hint}
    </div>
  )
}
