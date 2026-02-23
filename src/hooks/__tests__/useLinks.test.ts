import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLinks } from '../useLinks'
import { useHistory } from '../useHistory'
import { apiGetHistory, apiUndoLast } from '../../lib/tauriBridge'
import type { ActionRecord, LinkEntry } from '../../types'

vi.mock('../../lib/tauriBridge', () => ({
  apiGetHistory: vi.fn(),
  apiUndoLast: vi.fn(),
}))

const mockedApiGetHistory = vi.mocked(apiGetHistory)
const mockedApiUndoLast = vi.mocked(apiUndoLast)

const entries: LinkEntry[] = [
  { path: 'C:\\one', target: 'C:\\target1', link_type: 'Symlink', status: 'Ok' },
  { path: 'C:\\two', target: 'C:\\target2', link_type: 'Junction', status: 'Broken' },
  { path: 'D:\\three', target: 'D:\\target3', link_type: 'Hardlink', status: 'AccessDenied' },
]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function makeRecord(id: number, linkPath = `C:\\link-${id}`): ActionRecord {
  return {
    id,
    action_type: 'Create',
    link_path: linkPath,
    link_type: 'Symlink',
    timestamp: `2026-01-0${id}T00:00:00.000Z`,
    success: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useLinks', () => {
  it('filters by query, type and status', () => {
    const { result, rerender } = renderHook(
      ({ search, type, status }) =>
        useLinks(entries, {
          search,
          type,
          status,
        }),
      {
        initialProps: {
          search: 'two',
          type: 'All' as const,
          status: 'All' as const,
        },
      },
    )

    expect(result.current.filtered).toHaveLength(1)
    expect(result.current.filtered[0].path).toBe('C:\\two')

    rerender({
      search: '',
      type: 'Junction' as const,
      status: 'Broken' as const,
    })

    expect(result.current.filtered).toHaveLength(1)
    expect(result.current.filtered[0].link_type).toBe('Junction')

    rerender({
      search: '',
      type: 'All' as const,
      status: 'AccessDenied' as const,
    })

    expect(result.current.filtered).toHaveLength(1)
    expect(result.current.filtered[0].status).toBe('AccessDenied')
  })

  it('keeps selection in sync when filters remove the active row', () => {
    const { result, rerender } = renderHook(
      ({ search }) =>
        useLinks(entries, {
          search,
          type: 'All',
          status: 'All',
        }),
      {
        initialProps: {
          search: '',
        },
      },
    )

    act(() => {
      result.current.setSelectedPath('C:\\two')
    })

    expect(result.current.selectedPath).toBe('C:\\two')

    rerender({ search: 'three' })

    expect(result.current.selectedPath).toBe('D:\\three')

    rerender({ search: '' })

    expect(result.current.selectedPath).toBe('D:\\three')
  })
})

describe('useHistory', () => {
  it('keeps the latest load result when earlier requests resolve later', async () => {
    const firstRequest = deferred<ActionRecord[]>()
    const secondRequest = deferred<ActionRecord[]>()
    const firstPage = [makeRecord(1)]
    const secondPage = [makeRecord(2)]

    mockedApiGetHistory.mockImplementationOnce(() => firstRequest.promise)
    mockedApiGetHistory.mockImplementationOnce(() => secondRequest.promise)

    const { result } = renderHook(() => useHistory())

    await waitFor(() => {
      expect(mockedApiGetHistory).toHaveBeenCalledTimes(1)
      expect(mockedApiGetHistory).toHaveBeenLastCalledWith(20, 0)
    })

    act(() => {
      void result.current.load(20)
    })

    await waitFor(() => {
      expect(mockedApiGetHistory).toHaveBeenCalledTimes(2)
      expect(mockedApiGetHistory).toHaveBeenLastCalledWith(20, 20)
    })

    await act(async () => {
      secondRequest.resolve(secondPage)
      await secondRequest.promise
    })

    await waitFor(() => {
      expect(result.current.items).toEqual(secondPage)
      expect(result.current.offset).toBe(20)
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      firstRequest.resolve(firstPage)
      await firstRequest.promise
    })

    expect(result.current.items).toEqual(secondPage)
    expect(result.current.offset).toBe(20)
    expect(result.current.error).toBe('')
  })

  it('surfaces undo failures without replacing history data', async () => {
    const initialRecords = [makeRecord(1), makeRecord(2)]
    const undoError = new Error('Undo failed hard')

    mockedApiGetHistory.mockResolvedValueOnce(initialRecords)
    mockedApiUndoLast.mockRejectedValueOnce(undoError)

    const { result } = renderHook(() => useHistory())

    await waitFor(() => {
      expect(result.current.items).toEqual(initialRecords)
      expect(result.current.error).toBe('')
    })

    let thrown: unknown

    await act(async () => {
      try {
        await result.current.undoLast()
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBe(undoError)
    expect(result.current.error).toBe('Undo failed hard')
    expect(result.current.items).toEqual(initialRecords)
    expect(mockedApiGetHistory).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(false)
  })
})
