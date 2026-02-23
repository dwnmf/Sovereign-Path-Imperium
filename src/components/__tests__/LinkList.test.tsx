import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LinkList } from '../LinkList'
import type { LinkEntry } from '../../types'

function makeEntries(count: number): LinkEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `C:\\links\\item-${index}`,
    target: `C:\\target\\item-${index}`,
    link_type: index % 3 === 0 ? 'Junction' : index % 5 === 0 ? 'Hardlink' : 'Symlink',
    status: index % 7 === 0 ? 'Broken' : 'Ok',
  }))
}

describe('LinkList', () => {
  it('shows loading skeleton while scan is active with no entries', () => {
    const { container } = render(
      <LinkList
        entries={[]}
        activePath={null}
        onSelect={() => undefined}
        width={1200}
        height={500}
        isScanning
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelectorAll('.listSkeletonRow')).toHaveLength(9)
  })

  it('shows empty-state copy when no entries and not scanning', () => {
    render(
      <LinkList
        entries={[]}
        activePath={null}
        onSelect={() => undefined}
        width={1200}
        height={500}
        isScanning={false}
      />,
    )

    expect(screen.getByText('No links match these filters')).toBeInTheDocument()
    expect(screen.getByText('Reset search or switch status/type to repopulate this view.')).toBeInTheDocument()
  })

  it('renders path segments, statuses, active row and click selection', () => {
    const onSelect = vi.fn()
    const entries: LinkEntry[] = [
      {
        path: 'C:/links/folder/sample.txt',
        target: 'C:\\target\\sample.txt',
        link_type: 'Symlink',
        status: 'Ok',
      },
      {
        path: 'C:\\links\\junction-dir',
        target: 'C:\\target\\junction-dir',
        link_type: 'Junction',
        status: 'Ok',
      },
      {
        path: 'C:\\links\\denied-link',
        target: 'C:\\target\\denied-link',
        link_type: 'Hardlink',
        status: 'AccessDenied',
      },
      {
        path: 'C:\\links\\broken-link',
        target: 'C:\\target\\broken-link',
        link_type: 'Symlink',
        status: 'Broken',
      },
    ]

    render(
      <LinkList
        entries={entries}
        activePath={entries[2].path}
        onSelect={onSelect}
        width={1200}
        height={500}
        isScanning={false}
      />,
    )

    const firstPath = screen.getByTitle(entries[0].path).closest('button')
    expect(firstPath).toBeInTheDocument()
    if (!firstPath) {
      throw new Error('Expected the first row to render a clickable button')
    }

    fireEvent.click(firstPath)
    expect(onSelect).toHaveBeenCalledWith(entries[0].path)

    expect(screen.getByText('C:\\links\\folder\\')).toHaveClass('pathDim')
    expect(screen.getByText('sample.txt')).toHaveClass('pathAccent')

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Junction')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(screen.getByText('Broken')).toBeInTheDocument()

    expect(screen.getByLabelText('AccessDenied')).toHaveClass('statusBadge--accessdenied')
    expect(screen.getByLabelText('Broken')).toHaveClass('statusBadge--broken')
    expect(screen.getByTitle('C:\\target\\broken-link')).toHaveClass('targetText--broken')

    const activeButton = screen.getByTitle(entries[2].path).closest('button')
    expect(activeButton).toHaveClass('linkListRow--active')
  })

  it('renders large dataset without timing out', () => {
    const entries = makeEntries(10_000)

    render(
      <LinkList
        entries={entries}
        activePath={entries[0].path}
        onSelect={() => undefined}
        width={1200}
        height={500}
        isScanning={false}
      />,
    )

    expect(screen.getByTitle('C:\\links\\item-0')).toBeInTheDocument()
  })
})
