# symview

Desktop utility for Windows that scans, displays, creates and deletes NTFS filesystem links:

- Symbolic links
- Junctions
- Hardlinks

## Stack

- Tauri 2.0 (Rust backend)
- React 19 + TypeScript frontend
- Vite
- rusqlite (`bundled`)
- react-window virtualization
- Raw CSS (CSS variables)

## Prerequisites

- Windows 10/11 x64
- Node.js 20+
- pnpm
- Rust stable toolchain (`rustup` + `cargo`)
- Visual Studio Build Tools (Desktop development with C++)

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm install
pnpm tauri build
```

Target bundle is NSIS installer.

## Notes

- Symlink creation without admin requires Windows Developer Mode.
- USN Journal scan path requires elevated privileges for full speed/visibility.
- Without elevation, scan falls back to slower walkdir traversal.

## Project layout

```text
symview/
  src-tauri/
    src/
      main.rs
      commands/
      db/
      config.rs
      elevation.rs
      types.rs
  src/
    components/
    hooks/
    types.ts
```
