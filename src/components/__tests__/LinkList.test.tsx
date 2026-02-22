import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
  it('renders large dataset without timing out', () => {
    const entries = makeEntries(10_000)

    render(
      <LinkList
        entries={entries}
        activePath={entries[0].path}
        onSelect={() => undefined}
        width={1200}
        height={500}
      />,
    )

    expect(screen.getByTitle('C:\\links\\item-0')).toBeInTheDocument()
  })
})
