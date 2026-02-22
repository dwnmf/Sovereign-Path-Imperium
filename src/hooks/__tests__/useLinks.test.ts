import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLinks } from '../useLinks'
import type { LinkEntry } from '../../types'

const entries: LinkEntry[] = [
  { path: 'C:\\one', target: 'C:\\target1', link_type: 'Symlink', status: 'Ok' },
  { path: 'C:\\two', target: 'C:\\target2', link_type: 'Junction', status: 'Broken' },
  { path: 'D:\\three', target: 'D:\\target3', link_type: 'Hardlink', status: 'AccessDenied' },
]

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
})
