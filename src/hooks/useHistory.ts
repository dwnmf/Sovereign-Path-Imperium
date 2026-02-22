import { useCallback, useEffect, useState } from 'react'
import { apiGetHistory, apiUndoLast } from '../lib/tauriBridge'
import type { ActionRecord } from '../types'

const PAGE_SIZE = 20

export function useHistory() {
  const [items, setItems] = useState<ActionRecord[]>([])
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (nextOffset = 0) => {
    setIsLoading(true)
    setError('')

    try {
      const records = await apiGetHistory(PAGE_SIZE, nextOffset)
      setItems(records)
      setOffset(nextOffset)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load history')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const undoLast = useCallback(async () => {
    await apiUndoLast()
    await load(0)
  }, [load])

  useEffect(() => {
    void load(0)
  }, [load])

  return {
    items,
    offset,
    isLoading,
    error,
    load,
    undoLast,
    pageSize: PAGE_SIZE,
  }
}
