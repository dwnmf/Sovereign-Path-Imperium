import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGetHistory, apiUndoLast } from '../lib/tauriBridge'
import type { ActionRecord } from '../types'

const PAGE_SIZE = 20

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return fallback
}

export function useHistory() {
  const [items, setItems] = useState<ActionRecord[]>([])
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const isMountedRef = useRef(true)
  const latestLoadIdRef = useRef(0)
  const activeLoadIdRef = useRef<number | null>(null)
  const undoInFlightRef = useRef(false)

  const refreshLoadingState = useCallback(() => {
    setIsLoading(undoInFlightRef.current || activeLoadIdRef.current !== null)
  }, [])

  const load = useCallback(async (nextOffset = 0) => {
    const requestId = ++latestLoadIdRef.current
    activeLoadIdRef.current = requestId
    refreshLoadingState()
    setError('')

    try {
      const records = await apiGetHistory(PAGE_SIZE, nextOffset)

      if (!isMountedRef.current || requestId !== latestLoadIdRef.current) {
        return
      }

      setItems(records)
      setOffset(nextOffset)
    } catch (loadError) {
      if (!isMountedRef.current || requestId !== latestLoadIdRef.current) {
        return
      }

      setError(getErrorMessage(loadError, 'Unable to load history'))
    } finally {
      if (activeLoadIdRef.current === requestId) {
        activeLoadIdRef.current = null
      }
      if (isMountedRef.current) {
        refreshLoadingState()
      }
    }
  }, [refreshLoadingState])

  const undoLast = useCallback(async () => {
    undoInFlightRef.current = true
    refreshLoadingState()
    setError('')

    try {
      await apiUndoLast()
      await load(0)
    } catch (undoError) {
      if (isMountedRef.current) {
        setError(getErrorMessage(undoError, 'Unable to undo last action'))
      }
      throw undoError
    } finally {
      undoInFlightRef.current = false
      if (isMountedRef.current) {
        refreshLoadingState()
      }
    }
  }, [load, refreshLoadingState])

  useEffect(() => {
    void load(0)
  }, [load])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

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
