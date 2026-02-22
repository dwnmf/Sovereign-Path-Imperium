import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { List as FixedSizeList } from 'react-window'
import type { RowComponentProps } from 'react-window'
import './App.css'

type LinkType = 'Symlink' | 'Junction' | 'Hardlink'
type LinkTypeFilter = 'All' | LinkType
type LinkHealth = 'OK' | 'Broken'
type StatusFilter = 'All' | LinkHealth
type ObjectType = 'file' | 'dir'
type ModalMode = 'create' | 'edit'

interface LinkEntry {
  id: string
  linkPath: string
  targetPath: string
  linkType: LinkType
  health: LinkHealth
  objectType: ObjectType
  createdAt: string
  modifiedAt: string
  owner: string
  attributes: string
  searchKey: string
}

interface LinkFormValues {
  linkPath: string
  targetPath: string
  linkType: LinkType
}

interface FormErrors {
  linkPath?: string
  targetPath?: string
}

interface RowData {
  entries: LinkEntry[]
  activeId: string | null
  onSelect: (id: string) => void
}

const ROW_HEIGHT = 46
const SAMPLE_ENTRY_COUNT = 60000
const SCAN_VOLUME = 'C:'
const SCAN_METHOD = 'USN Journal / walkdir fallback'
const PATH_INVALID_CHARS = /[<>:"|?*]/
const formatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function normalizePath(path: string): string {
  return path.trim().replaceAll('/', '\\')
}

function splitPath(path: string): { directory: string; fileName: string } {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('\\')

  if (lastSlash === -1) {
    return {
      directory: '',
      fileName: normalized,
    }
  }

  return {
    directory: normalized.slice(0, lastSlash + 1),
    fileName: normalized.slice(lastSlash + 1),
  }
}

function isValidWindowsPath(path: string): boolean {
  const normalized = normalizePath(path)

  if (!normalized || PATH_INVALID_CHARS.test(normalized.replace(/^[A-Za-z]:/, ''))) {
    return false
  }

  const drivePath = /^[A-Za-z]:\\[^\\]+(?:\\[^\\]+)*\\?$/.test(normalized)
  const uncPath = /^\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+(?:\\[^\\/:*?"<>|]+)*\\?$/.test(
    normalized,
  )

  return drivePath || uncPath
}

function formatDate(value: string): string {
  return formatter.format(new Date(value))
}

function statusBadge(entry: LinkEntry): { label: 'OK' | '!!!' | 'JNC'; tone: 'ok' | 'broken' | 'junction' } {
  if (entry.linkType === 'Junction') {
    return { label: 'JNC', tone: 'junction' }
  }

  if (entry.health === 'Broken') {
    return { label: '!!!', tone: 'broken' }
  }

  return { label: 'OK', tone: 'ok' }
}

function buildSearchKey(linkPath: string, targetPath: string): string {
  return `${linkPath} ${targetPath}`.toLowerCase()
}

function generateMockEntry(
  index: number,
  volume: string,
  override?: Partial<Pick<LinkEntry, 'linkPath' | 'targetPath' | 'linkType'>>,
): LinkEntry {
  const owners = ['BUILTIN\\Administrators', 'SYSTEM', 'k1NG', 'TrustedInstaller']
  const projects = ['Projects', 'Workspace', 'ProgramData', 'Users\\k1NG\\Links']
  const targets = ['Windows\\System32', 'Tools\\Build', 'Data\\Backups', 'Dev\\Modules']

  const linkType: LinkType =
    override?.linkType ?? (index % 16 === 0 ? 'Hardlink' : index % 5 === 0 ? 'Junction' : 'Symlink')
  const isBroken = index % 13 === 0
  const objectType: ObjectType = linkType === 'Junction' || index % 3 === 0 ? 'dir' : 'file'

  const linkSuffix = index.toString().padStart(6, '0')
  const linkPath =
    override?.linkPath ??
    `${volume}\\${projects[index % projects.length]}\\${linkType.toLowerCase()}-${linkSuffix}${
      objectType === 'file' ? '.lnk' : ''
    }`
  const targetPath =
    override?.targetPath ??
    `${volume}\\${isBroken ? 'Missing\\Path' : targets[index % targets.length]}\\target-${linkSuffix}${
      objectType === 'file' ? '.bin' : ''
    }`

  const createdAt = new Date(Date.now() - (index + 1) * 95_000).toISOString()
  const modifiedAt = new Date(Date.now() - (index + 1) * 27_000).toISOString()

  const attributes = [
    objectType === 'dir' ? 'Directory' : 'Archive',
    index % 2 === 0 ? 'ReadOnly' : 'Writable',
    index % 4 === 0 ? 'Hidden' : 'Normal',
  ].join(', ')

  const health: LinkHealth = targetPath.includes('\\Missing\\') ? 'Broken' : 'OK'

  return {
    id: `entry-${index}`,
    linkPath,
    targetPath,
    linkType,
    health,
    objectType,
    createdAt,
    modifiedAt,
    owner: owners[index % owners.length],
    attributes,
    searchKey: buildSearchKey(linkPath, targetPath),
  }
}

function generateMockScanResults(count: number, volume: string): LinkEntry[] {
  const list = new Array<LinkEntry>(count)

  for (let index = 0; index < count; index += 1) {
    list[index] = generateMockEntry(index, volume)
  }

  return list
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function runMockScan(volume: string): Promise<LinkEntry[]> {
  await delay(650)
  return generateMockScanResults(SAMPLE_ENTRY_COUNT, volume)
}

async function backendCreateLink(values: LinkFormValues, existing: LinkEntry[]): Promise<LinkEntry> {
  await delay(340)

  const linkPath = normalizePath(values.linkPath)
  const targetPath = normalizePath(values.targetPath)

  if (existing.some((entry) => entry.linkPath.toLowerCase() === linkPath.toLowerCase())) {
    throw new Error('Backend: this link path already exists.')
  }

  if (targetPath.toLowerCase().includes('\\windows\\system32\\config')) {
    throw new Error('Backend: target path is protected by policy.')
  }

  return generateMockEntry(existing.length + 1, SCAN_VOLUME, {
    linkPath,
    targetPath,
    linkType: values.linkType,
  })
}

async function backendRetargetLink(entry: LinkEntry, newTargetPath: string): Promise<LinkEntry> {
  await delay(260)

  const targetPath = normalizePath(newTargetPath)

  if (targetPath.toLowerCase().includes('\\forbidden\\')) {
    throw new Error('Backend: unable to retarget to this location.')
  }

  const health: LinkHealth = targetPath.includes('\\Missing\\') ? 'Broken' : 'OK'

  return {
    ...entry,
    targetPath,
    health,
    modifiedAt: new Date().toISOString(),
    searchKey: buildSearchKey(entry.linkPath, targetPath),
  }
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const node = ref.current

    if (!node) {
      return
    }

    const syncSize = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    syncSize()

    const observer = new ResizeObserver(syncSize)
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

  return {
    ref,
    size,
  }
}

function LinkRow({ index, style, entries, activeId, onSelect }: RowComponentProps<RowData>) {
  const entry = entries[index]
  const isActive = activeId === entry.id
  const badge = statusBadge(entry)
  const { directory, fileName } = splitPath(entry.linkPath)

  return (
    <div style={style} className="rowWrap">
      <button
        className={`linkRow ${isActive ? 'linkRow--active' : ''}`}
        onClick={() => onSelect(entry.id)}
        type="button"
      >
        <div className="rowLine">
          <span className="pathText" title={entry.linkPath}>
            <span className="pathDirectory">{directory}</span>
            <span className="pathFile">{fileName}</span>
          </span>
          <span className="pathArrow" aria-hidden="true">
            -&gt;
          </span>
          <span
            className={`targetText ${entry.health === 'Broken' ? 'targetText--broken' : ''}`}
            title={entry.targetPath}
          >
            {entry.targetPath}
          </span>
        </div>
        <span className={`statusTag statusTag--${badge.tone}`}>{badge.label}</span>
      </button>
    </div>
  )
}

function App() {
  const [entries, setEntries] = useState<LinkEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<LinkTypeFilter>('All')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')

  const [isScanning, setIsScanning] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [backendError, setBackendError] = useState('')
  const [formErrors, setFormErrors] = useState<FormErrors>({})

  const [formValues, setFormValues] = useState<LinkFormValues>({
    linkPath: `${SCAN_VOLUME}\\Users\\k1NG\\Links\\new-link.lnk`,
    targetPath: `${SCAN_VOLUME}\\Dev\\Modules\\target.bin`,
    linkType: 'Symlink',
  })

  const { ref: viewportRef, size: viewportSize } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false

    const scan = async () => {
      setIsScanning(true)

      try {
        const result = await runMockScan(SCAN_VOLUME)

        if (cancelled) {
          return
        }

        setEntries(result)
        setSelectedId(result[0]?.id ?? null)
      } finally {
        if (!cancelled) {
          setIsScanning(false)
        }
      }
    }

    scan()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return entries.filter((entry) => {
      const matchesQuery = query.length === 0 || entry.searchKey.includes(query)
      const matchesType = typeFilter === 'All' || entry.linkType === typeFilter
      const matchesStatus = statusFilter === 'All' || entry.health === statusFilter

      return matchesQuery && matchesType && matchesStatus
    })
  }, [entries, searchQuery, typeFilter, statusFilter])

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedId(null)
      return
    }

    if (!selectedId || !filteredEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredEntries[0].id)
    }
  }, [filteredEntries, selectedId])

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedId) ?? null,
    [filteredEntries, selectedId],
  )

  const rowData = useMemo<RowData>(
    () => ({
      entries: filteredEntries,
      activeId: selectedId,
      onSelect: setSelectedId,
    }),
    [filteredEntries, selectedId],
  )

  const stats = useMemo(() => {
    let working = 0
    let broken = 0
    let junctions = 0

    for (const entry of entries) {
      if (entry.health === 'Broken') {
        broken += 1
      } else {
        working += 1
      }

      if (entry.linkType === 'Junction') {
        junctions += 1
      }
    }

    return { working, broken, junctions }
  }, [entries])

  const openCreateModal = () => {
    setModalMode('create')
    setEditingId(null)
    setFormValues({
      linkPath: `${SCAN_VOLUME}\\Users\\k1NG\\Links\\new-link.lnk`,
      targetPath: `${SCAN_VOLUME}\\Dev\\Modules\\target.bin`,
      linkType: 'Symlink',
    })
    setFormErrors({})
    setBackendError('')
    setIsModalOpen(true)
  }

  const openEditModal = () => {
    if (!selectedEntry) {
      return
    }

    setModalMode('edit')
    setEditingId(selectedEntry.id)
    setFormValues({
      linkPath: selectedEntry.linkPath,
      targetPath: selectedEntry.targetPath,
      linkType: selectedEntry.linkType,
    })
    setFormErrors({})
    setBackendError('')
    setIsModalOpen(true)
  }

  const closeModal = (force = false) => {
    if (isSaving && !force) {
      return
    }

    setIsModalOpen(false)
    setBackendError('')
    setFormErrors({})
  }

  const validateModal = (): FormErrors => {
    const errors: FormErrors = {}

    if (!isValidWindowsPath(formValues.linkPath)) {
      errors.linkPath = 'Link path must be an absolute Windows path.'
    }

    if (!isValidWindowsPath(formValues.targetPath)) {
      errors.targetPath = 'Target path must be an absolute Windows path.'
    }

    return errors
  }

  const handleModalSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const errors = validateModal()
    setFormErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    setIsSaving(true)
    setBackendError('')

    try {
      if (modalMode === 'create') {
        const created = await backendCreateLink(formValues, entries)

        setEntries((previous) => [created, ...previous])
        setSelectedId(created.id)
      } else {
        if (!editingId) {
          throw new Error('Edit mode is missing selected entry id.')
        }

        const current = entries.find((entry) => entry.id === editingId)

        if (!current) {
          throw new Error('Selected entry was not found during retarget.')
        }

        const updated = await backendRetargetLink(current, formValues.targetPath)

        setEntries((previous) =>
          previous.map((entry) => {
            if (entry.id === editingId) {
              return updated
            }

            return entry
          }),
        )
        setSelectedId(updated.id)
      }

      closeModal(true)
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Backend returned an unknown error.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = () => {
    if (!selectedEntry) {
      return
    }

    const confirmed = window.confirm(`Delete link?\n\n${selectedEntry.linkPath}`)

    if (!confirmed) {
      return
    }

    setEntries((previous) => previous.filter((entry) => entry.id !== selectedEntry.id))
  }

  const handleOpenTarget = () => {
    if (!selectedEntry) {
      return
    }

    const fileUrl = `file:///${selectedEntry.targetPath.replaceAll('\\', '/')}`
    window.open(fileUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="appShell">
      <header className="toolbar">
        <div className="toolbarGroup toolbarGroup--grow">
          <input
            className="searchInput"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by path..."
            type="search"
            value={searchQuery}
          />
          <select
            className="toolbarSelect"
            onChange={(event) => setTypeFilter(event.target.value as LinkTypeFilter)}
            value={typeFilter}
          >
            <option value="All">All</option>
            <option value="Symlink">Symlink</option>
            <option value="Junction">Junction</option>
            <option value="Hardlink">Hardlink</option>
          </select>
          <select
            className="toolbarSelect"
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            value={statusFilter}
          >
            <option value="All">All</option>
            <option value="OK">OK</option>
            <option value="Broken">Broken</option>
          </select>
        </div>

        <div className="toolbarGroup">
          {isScanning ? (
            <div className="scanIndicator" aria-live="polite">
              <span className="spinner" />
              <span>Scanning {SCAN_VOLUME}...</span>
            </div>
          ) : null}

          <button className="button button--primary" onClick={openCreateModal} type="button">
            New link
          </button>
        </div>
      </header>

      <main className="panelGrid">
        <section className="panel panel--left">
          <div className="panelHeader">
            <span className="panelTitle">Links</span>
            <span className="panelMeta">{filteredEntries.length.toLocaleString()} shown</span>
          </div>

          <div className="listViewport" ref={viewportRef}>
            {filteredEntries.length === 0 ? (
              <div className="emptyState">No links match current filters.</div>
            ) : null}

            {filteredEntries.length > 0 && viewportSize.height > 0 && viewportSize.width > 0 ? (
              <FixedSizeList
                className="virtualList"
                rowComponent={LinkRow}
                rowCount={filteredEntries.length}
                rowHeight={ROW_HEIGHT}
                rowProps={rowData}
                style={{ height: viewportSize.height, width: viewportSize.width }}
              />
            ) : null}
          </div>
        </section>

        <aside className="panel panel--right">
          <div className="panelHeader">
            <span className="panelTitle">Details</span>
          </div>

          {selectedEntry ? (
            <div className="detailsPanel">
              <div className="detailsGrid">
                <span className="detailLabel">Status</span>
                <span>
                  <span
                    className={`statusChip ${
                      selectedEntry.health === 'OK' ? 'statusChip--ok' : 'statusChip--broken'
                    }`}
                  >
                    {selectedEntry.health}
                  </span>
                </span>

                <span className="detailLabel">Symlink path</span>
                <span className="detailValue">{selectedEntry.linkPath}</span>

                <span className="detailLabel">Target path</span>
                <span
                  className={`detailValue ${
                    selectedEntry.health === 'Broken' ? 'detailValue--broken' : ''
                  }`}
                >
                  {selectedEntry.targetPath}
                </span>

                <span className="detailLabel">Type</span>
                <span className="detailValue">{selectedEntry.linkType}</span>

                <span className="detailLabel">Object</span>
                <span className="detailValue">{selectedEntry.objectType}</span>

                <span className="detailLabel">Created</span>
                <span className="detailValue">{formatDate(selectedEntry.createdAt)}</span>

                <span className="detailLabel">Modified</span>
                <span className="detailValue">{formatDate(selectedEntry.modifiedAt)}</span>

                <span className="detailLabel">Owner</span>
                <span className="detailValue">{selectedEntry.owner}</span>

                <span className="detailLabel">Attributes</span>
                <span className="detailValue">{selectedEntry.attributes}</span>
              </div>

              <div className="actionBar">
                <button className="button" onClick={handleOpenTarget} type="button">
                  Open target
                </button>
                <button className="button" onClick={openEditModal} type="button">
                  Edit
                </button>
                <button className="button button--danger" onClick={handleDelete} type="button">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="emptyState">Select an entry from the left panel.</div>
          )}
        </aside>
      </main>

      <footer className="statusBar">
        <span>{stats.working.toLocaleString()} working</span>
        <span>{stats.broken.toLocaleString()} broken</span>
        <span>{stats.junctions.toLocaleString()} junctions</span>
        <span className="statusBarSpacer" />
        <span>
          {SCAN_VOLUME} | {SCAN_METHOD}
        </span>
      </footer>

      {isModalOpen ? (
        <div className="modalBackdrop" onClick={() => closeModal()} role="presentation">
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>{modalMode === 'create' ? 'Create new link' : 'Retarget link'}</h2>
            </div>

            <form onSubmit={handleModalSubmit}>
              <div className="fieldGroup">
                <label htmlFor="linkPath">Link path</label>
                <input
                  disabled={modalMode === 'edit'}
                  id="linkPath"
                  onChange={(event) =>
                    setFormValues((previous) => ({
                      ...previous,
                      linkPath: event.target.value,
                    }))
                  }
                  type="text"
                  value={formValues.linkPath}
                />
                {formErrors.linkPath ? <p className="fieldError">{formErrors.linkPath}</p> : null}
              </div>

              <div className="fieldGroup">
                <label htmlFor="targetPath">Target path</label>
                <input
                  id="targetPath"
                  onChange={(event) =>
                    setFormValues((previous) => ({
                      ...previous,
                      targetPath: event.target.value,
                    }))
                  }
                  type="text"
                  value={formValues.targetPath}
                />
                {formErrors.targetPath ? <p className="fieldError">{formErrors.targetPath}</p> : null}
              </div>

              <div className="fieldGroup">
                <label htmlFor="linkType">Link type</label>
                <select
                  disabled={modalMode === 'edit'}
                  id="linkType"
                  onChange={(event) =>
                    setFormValues((previous) => ({
                      ...previous,
                      linkType: event.target.value as LinkType,
                    }))
                  }
                  value={formValues.linkType}
                >
                  <option value="Symlink">Symlink</option>
                  <option value="Junction">Junction</option>
                  <option value="Hardlink">Hardlink</option>
                </select>
              </div>

              {backendError ? <div className="backendError">{backendError}</div> : null}

              <div className="modalActions">
                <button className="button" onClick={() => closeModal()} type="button">
                  Cancel
                </button>
                <button className="button button--primary" disabled={isSaving} type="submit">
                  {isSaving ? 'Saving...' : modalMode === 'create' ? 'Create link' : 'Save target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
