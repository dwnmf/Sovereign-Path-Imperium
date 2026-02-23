import { useEffect, useMemo, useState } from 'react'
import type { LinkEntry, StatusFilter, TypeFilter } from '../types'

interface LinkFilters {
  search: string
  type: TypeFilter
  status: StatusFilter
}

export function useLinks(entries: LinkEntry[], filters: LinkFilters) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase()

    return entries.filter((entry) => {
      const text = `${entry.path} ${entry.target}`.toLowerCase()
      const typeMatch = filters.type === 'All' || entry.link_type === filters.type
      const statusMatch =
        filters.status === 'All' ||
        (filters.status === 'Working' && entry.status === 'Ok') ||
        (filters.status === 'Broken' && entry.status === 'Broken') ||
        (filters.status === 'AccessDenied' && entry.status === 'AccessDenied')

      return text.includes(query) && typeMatch && statusMatch
    })
  }, [entries, filters.search, filters.status, filters.type])

  const activePath = useMemo(() => {
    if (filtered.length === 0) {
      return null
    }

    if (!selectedPath || !filtered.some((entry) => entry.path === selectedPath)) {
      return filtered[0].path
    }

    return selectedPath
  }, [filtered, selectedPath])

  useEffect(() => {
    if (selectedPath !== activePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selection anchored to filtered list after data/filter changes.
      setSelectedPath(activePath)
    }
  }, [activePath, selectedPath])

  const selectedEntry = useMemo(
    () => filtered.find((entry) => entry.path === activePath) ?? null,
    [activePath, filtered],
  )

  const stats = useMemo(() => {
    let working = 0
    let broken = 0
    let junctions = 0
    let hardlinks = 0
    let symlinks = 0

    for (const entry of entries) {
      if (entry.status === 'Ok') {
        working += 1
      }

      if (entry.status === 'Broken') {
        broken += 1
      }

      if (entry.link_type === 'Junction') {
        junctions += 1
      }

      if (entry.link_type === 'Hardlink') {
        hardlinks += 1
      }

      if (entry.link_type === 'Symlink') {
        symlinks += 1
      }
    }

    return { working, broken, junctions, hardlinks, symlinks }
  }, [entries])

  return {
    filtered,
    selectedPath: activePath,
    selectedEntry,
    setSelectedPath,
    stats,
  }
}
