import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@renderer/ui/components/button'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { MultiSelect, type MultiSelectOption } from '@renderer/ui/components/multi-select'
import type { Tone } from '@renderer/ui/lib/types'

import type { LogLine, ResourceRef } from '../../../shared/ipc-types'
import { usePodLogs, type LogStatus } from '../lib/use-pod-logs'

const SRC_COLORS = ['text-info', 'text-success', 'text-warning', 'text-primary', 'text-foreground']
const colorFor = (key: string): string =>
  SRC_COLORS[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % SRC_COLORS.length]

const STATUS_TONE: Record<LogStatus, Tone> = {
  connecting: 'dim',
  streaming: 'success',
  error: 'destructive',
  ended: 'dim'
}

// A line's source label: pod name for workloads (many pods), container otherwise.
const srcLabel = (l: LogLine): string => l.pod || l.container

// Optional column toggles — values double as the visible MultiSelect labels.
const TS = 'Timestamp'
const POD = 'Pod name'

type MatchLine = {
  ranges: Array<{ start: number; end: number }>
}

type MatchOccurrence = {
  lineIndex: number
  rangeIndex: number
}

const findRanges = (message: string, query: string): Array<{ start: number; end: number }> => {
  if (!query) return []
  const ranges: Array<{ start: number; end: number }> = []
  const haystack = message.toLowerCase()
  const needle = query.toLowerCase()
  let from = 0
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start === -1) break
    const end = start + needle.length
    ranges.push({ start, end })
    from = end
  }
  return ranges
}

function HighlightedMessage({
  message,
  ranges,
  activeRange
}: {
  message: string
  ranges: Array<{ start: number; end: number }>
  activeRange: number | null
}) {
  if (ranges.length === 0) return <>{message}</>

  const parts: ReactNode[] = []
  let last = 0
  ranges.forEach((range, i) => {
    if (range.start > last) parts.push(message.slice(last, range.start))
    parts.push(
      <mark
        key={`${range.start}-${range.end}`}
        className={
          i === activeRange
            ? 'rounded-[2px] bg-primary px-0.5 text-primary-foreground'
            : 'rounded-[2px] bg-warning/30 px-0.5 text-foreground'
        }
      >
        {message.slice(range.start, range.end)}
      </mark>
    )
    last = range.end
  })
  if (last < message.length) parts.push(message.slice(last))
  return <>{parts}</>
}

export function LogsPane({
  clusterId,
  refs,
  container
}: {
  clusterId: string
  refs: ResourceRef[]
  container?: string
}) {
  const { lines, status, paused, setPaused, clear } = usePodLogs(
    clusterId,
    refs,
    container ? { container } : {}
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const followRef = useRef(true)
  const refsKey = refs.map((r) => `${r.kind}/${r.namespace ?? ''}/${r.name}`).join('|')
  const [podSel, setPodSel] = useState<string[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  // Which optional columns are shown. Empty = both hidden (default).
  const [fields, setFields] = useState<string[]>([])
  const showTs = fields.includes(TS)
  const showSrc = fields.includes(POD)
  const gridCols = [showTs && '180px', showSrc && '140px', '1fr'].filter(Boolean).join(' ')

  // Pods that have actually emitted log lines — the only ones worth filtering.
  const podOptions = useMemo<MultiSelectOption[]>(() => {
    const counts: Record<string, number> = {}
    for (const l of lines) if (l.pod) counts[l.pod] = (counts[l.pod] ?? 0) + 1
    return Object.keys(counts)
      .sort()
      .map((p) => ({ value: p, count: counts[p] }))
  }, [lines])

  // Drop a stale selection (e.g. after Clear) so it never blanks the pane.
  const effectivePodSel = useMemo(() => {
    const known = new Set(podOptions.map((o) => o.value))
    return podSel.filter((p) => known.has(p))
  }, [podSel, podOptions])

  const filtered = useMemo(
    () =>
      effectivePodSel.length === 0 ? lines : lines.filter((l) => effectivePodSel.includes(l.pod)),
    [lines, effectivePodSel]
  )

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 24
  })

  const { matchLines, occurrences } = useMemo(() => {
    const query = searchQuery.trim()
    if (!query)
      return { matchLines: new Map<number, MatchLine>(), occurrences: [] as MatchOccurrence[] }

    const nextMatchLines = new Map<number, MatchLine>()
    const nextOccurrences: MatchOccurrence[] = []
    filtered.forEach((line, lineIndex) => {
      const ranges = findRanges(line.msg, query)
      if (ranges.length === 0) return
      nextMatchLines.set(lineIndex, { ranges })
      ranges.forEach((_, rangeIndex) => nextOccurrences.push({ lineIndex, rangeIndex }))
    })
    return { matchLines: nextMatchLines, occurrences: nextOccurrences }
  }, [filtered, searchQuery])

  const matchCount = occurrences.length
  const activeOccurrence = matchCount > 0 ? occurrences[activeMatchIndex] : null

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      const root = rootRef.current
      const active = document.activeElement
      if (!root || (active !== document.body && active != null && !root.contains(active))) return
      event.preventDefault()
      setSearchOpen(true)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [searchOpen])

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [searchQuery])

  useEffect(() => {
    if (matchCount === 0) {
      setActiveMatchIndex(0)
      return
    }
    setActiveMatchIndex((i) => Math.min(i, matchCount - 1))
  }, [matchCount])

  useEffect(() => {
    if (!activeOccurrence) return
    followRef.current = false
    virtualizer.scrollToIndex(activeOccurrence.lineIndex, { align: 'center' })
  }, [activeOccurrence, virtualizer])

  // Auto-scroll to the bottom on new lines while following.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [filtered])

  // Disable follow when the user scrolls up; re-enable near the bottom.
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  // Reset follow when switching targets.
  useEffect(() => {
    followRef.current = true
  }, [refsKey])

  const jumpToBottom = (): void => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      followRef.current = true
    }
  }

  const exportLogs = (): void => {
    const text = filtered.map((l) => `${l.ts} ${srcLabel(l)} ${l.msg}`).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${refs[0]?.name ?? 'pods'}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const moveMatch = (delta: number): void => {
    if (matchCount === 0) return
    followRef.current = false
    setActiveMatchIndex((i) => (i + delta + matchCount) % matchCount)
  }

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      moveMatch(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setSearchOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-background">
      <div className="flex h-9 items-center gap-2 border-b border-border bg-chrome px-3 font-mono text-xs">
        <Dot tone={STATUS_TONE[status]} pulse={status === 'streaming'} />
        <span className="text-dim">
          {status === 'streaming' && !paused
            ? 'streaming'
            : paused
              ? 'paused'
              : status === 'error'
                ? 'error'
                : status === 'ended'
                  ? 'ended'
                  : 'connecting…'}
        </span>
        {container && <span className="text-dim">· {container}</span>}
        <span className="text-faint">· {filtered.length} lines</span>
        <div className="ml-auto flex items-center gap-1.5">
          {podOptions.length > 1 && (
            <MultiSelect
              label="Pods"
              options={podOptions}
              selected={effectivePodSel}
              onChange={setPodSel}
              width="w-64"
            />
          )}
          <MultiSelect
            label="Fields"
            icon="columns"
            options={[TS, POD]}
            selected={fields}
            onChange={setFields}
            width="w-44"
          />
          <Button
            aria-pressed={searchOpen}
            variant={searchOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Icon name="search" className="h-3.5 w-3.5" />
            Search
          </Button>
          <Button variant="ghost" size="sm" onClick={jumpToBottom}>
            <Icon name="arrowDown" className="h-3.5 w-3.5" />
            Bottom
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)}>
            <Icon name="play" className="h-3.5 w-3.5" />
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            <Icon name="trash" className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button variant="ghost" size="sm" disabled={filtered.length === 0} onClick={exportLogs}>
            <Icon name="download" className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>
      {searchOpen && (
        <div className="flex h-9 items-center gap-2 border-b border-border bg-background px-3 font-mono text-xs">
          <Icon name="search" className="h-3.5 w-3.5 text-dim" />
          <Input
            ref={searchInputRef}
            aria-label="Search logs"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            className="h-7 max-w-sm"
            placeholder="Find in log messages"
          />
          <span className="min-w-16 text-right tabular-nums text-faint">
            {matchCount === 0 ? '0 / 0' : `${activeMatchIndex + 1} / ${matchCount}`}
          </span>
          <Button
            aria-label="Previous match"
            variant="ghost"
            size="icon-sm"
            disabled={matchCount === 0}
            onClick={() => moveMatch(-1)}
          >
            <Icon name="arrowDown" className="h-3.5 w-3.5 rotate-180" />
          </Button>
          <Button
            aria-label="Next match"
            variant="ghost"
            size="icon-sm"
            disabled={matchCount === 0}
            onClick={() => moveMatch(1)}
          >
            <Icon name="arrowDown" className="h-3.5 w-3.5" />
          </Button>
          <Button
            aria-label="Close search"
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => setSearchOpen(false)}
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto p-3 font-mono text-[12px] leading-[1.6]"
      >
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-dim">
            {status === 'error'
              ? 'Failed to stream logs'
              : lines.length > 0
                ? 'No logs from selected pods'
                : 'Waiting for logs…'}
          </div>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const l = filtered[virtualRow.index]
              const matchLine = matchLines.get(virtualRow.index)
              const activeRange =
                activeOccurrence?.lineIndex === virtualRow.index
                  ? activeOccurrence.rangeIndex
                  : null
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 grid w-full gap-2.5 py-px"
                  style={{
                    gridTemplateColumns: gridCols,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  {showTs && (
                    <span className="truncate text-faint" title={l.ts}>
                      {l.ts}
                    </span>
                  )}
                  {showSrc && (
                    <span className={`truncate ${colorFor(srcLabel(l))}`} title={srcLabel(l)}>
                      {srcLabel(l)}
                    </span>
                  )}
                  <span className="whitespace-pre-wrap break-all text-foreground">
                    <HighlightedMessage
                      message={l.msg}
                      ranges={matchLine?.ranges ?? []}
                      activeRange={activeRange}
                    />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
