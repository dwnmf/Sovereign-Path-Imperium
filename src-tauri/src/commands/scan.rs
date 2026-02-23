use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::fs;
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, ERROR_HANDLE_EOF};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::DeviceIoControl;
use windows_sys::Win32::System::Ioctl::{FSCTL_ENUM_USN_DATA, FSCTL_GET_REPARSE_POINT, FSCTL_QUERY_USN_JOURNAL};

use crate::config::load_config;
use crate::types::{LinkEntry, LinkStatus, LinkType, ScanBatch, ScanMode, ScanProgress, ScanResult};

const GENERIC_READ_ACCESS: u32 = 0x8000_0000;
const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA0000003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000000C;
const SCAN_BATCH_SIZE: usize = 256;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MftEnumDataV0 {
    start_file_reference_number: u64,
    low_usn: i64,
    high_usn: i64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct UsnJournalDataV0 {
    usn_journal_id: u64,
    first_usn: i64,
    next_usn: i64,
    lowest_valid_usn: i64,
    max_usn: i64,
    maximum_size: u64,
    allocation_delta: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct UsnRecordV2Header {
    record_length: u32,
    major_version: u16,
    minor_version: u16,
    file_reference_number: u64,
    parent_file_reference_number: u64,
    usn: i64,
    timestamp: i64,
    reason: u32,
    source_info: u32,
    security_id: u32,
    file_attributes: u32,
    file_name_length: u16,
    file_name_offset: u16,
}

#[derive(Clone)]
struct FrnNode {
    parent_frn: u64,
    name: String,
    file_attributes: u32,
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn is_valid(&self) -> bool {
        self.0 != std::ptr::null_mut() && self.0 != INVALID_HANDLE_VALUE
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.is_valid() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

fn to_wide_null(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn parse_drive_letter(drive: &str) -> Result<char, String> {
    let trimmed = drive.trim();
    let mut chars = trimmed.chars();

    let letter = chars
        .next()
        .ok_or_else(|| "Drive is empty. Expected format like C:".to_string())?;

    if !letter.is_ascii_alphabetic() {
        return Err(format!("Invalid drive letter in path: {drive}"));
    }

    match chars.next() {
        Some(':') => {}
        _ => return Err(format!("Invalid drive format: {drive}. Expected format like C:")),
    }

    let remainder = chars.as_str();
    if !remainder.is_empty() && !remainder.chars().all(|c| c == '\\' || c == '/') {
        return Err(format!("Invalid drive format: {drive}. Expected format like C:"));
    }

    Ok(letter.to_ascii_uppercase())
}

fn normalize_drive(drive: &str) -> Result<String, String> {
    let letter = parse_drive_letter(drive)?;
    Ok(format!("{letter}:\\"))
}

fn normalize_path_for_prefix_compare(value: &str) -> String {
    value
        .trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn should_exclude(path: &Path, excluded: &[String]) -> bool {
    let path_text = normalize_path_for_prefix_compare(&path.to_string_lossy());

    excluded.iter().any(|item| {
        let excluded_text = normalize_path_for_prefix_compare(item);
        if excluded_text.is_empty() {
            return false;
        }

        if path_text == excluded_text {
            return true;
        }

        let mut excluded_prefix = excluded_text;
        excluded_prefix.push('\\');
        path_text.starts_with(&excluded_prefix)
    })
}

fn emit_scan_batch(app: &AppHandle, batch: &mut Vec<LinkEntry>) {
    if batch.is_empty() {
        return;
    }

    let payload = ScanBatch {
        entries: std::mem::take(batch),
    };
    let _ = app.emit("scan:batch", payload);
}

fn map_symlink_type(path: &Path, target: &str) -> LinkType {
    let path_text = path.to_string_lossy().to_string();
    if let Ok(tag) = get_reparse_tag(&path_text) {
        return match tag {
            IO_REPARSE_TAG_MOUNT_POINT => LinkType::Junction,
            IO_REPARSE_TAG_SYMLINK => LinkType::Symlink,
            _ => LinkType::Symlink,
        };
    }

    let resolved = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        path.parent()
            .unwrap_or_else(|| Path::new(""))
            .join(target)
    };

    if resolved.is_dir() {
        LinkType::Junction
    } else {
        LinkType::Symlink
    }
}

fn find_hardlink_target(path: &Path) -> String {
    let path_str = path.to_string_lossy().to_string();

    let output = Command::new("fsutil")
        .args(["hardlink", "list", &path_str])
        .output();

    match output {
        Ok(value) if value.status.success() => {
            let stdout = String::from_utf8_lossy(&value.stdout).to_string();
            let mut lines = stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>();

            if lines.is_empty() {
                return path_str;
            }

            if let Some(candidate) = lines
                .iter()
                .find(|item| item.to_lowercase() != path_str.to_lowercase())
            {
                return (*candidate).to_string();
            }

            lines.remove(0).to_string()
        }
        _ => path_str,
    }
}

fn open_file_handle(path: &str, open_reparse_point: bool) -> Result<OwnedHandle, String> {
    let wide = to_wide_null(path);
    let mut flags = FILE_FLAG_BACKUP_SEMANTICS;

    if open_reparse_point {
        flags |= FILE_FLAG_OPEN_REPARSE_POINT;
    }

    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ_ACCESS,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            std::ptr::null_mut(),
        )
    };

    let owned = OwnedHandle(handle);

    if !owned.is_valid() {
        return Err(format!("CreateFileW failed for {path}: {}", unsafe { GetLastError() }));
    }

    Ok(owned)
}

fn get_reparse_tag(path: &str) -> Result<u32, String> {
    let handle = open_file_handle(path, true)?;

    let mut bytes_returned = 0_u32;
    let mut out_buffer = vec![0_u8; 16 * 1024];

    let ok = unsafe {
        DeviceIoControl(
            handle.0,
            FSCTL_GET_REPARSE_POINT,
            std::ptr::null_mut(),
            0,
            out_buffer.as_mut_ptr() as *mut c_void,
            out_buffer.len() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        return Err(format!(
            "FSCTL_GET_REPARSE_POINT failed for {path}: {}",
            unsafe { GetLastError() }
        ));
    }

    if bytes_returned < 4 {
        return Err("Reparse buffer too short".to_string());
    }

    let mut tag_bytes = [0_u8; 4];
    tag_bytes.copy_from_slice(&out_buffer[0..4]);
    Ok(u32::from_le_bytes(tag_bytes))
}

fn get_hardlink_info(path: &str) -> Result<(u32, u64, u32), String> {
    let handle = open_file_handle(path, false)?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe { GetFileInformationByHandle(handle.0, &mut info as *mut BY_HANDLE_FILE_INFORMATION) };

    if ok == 0 {
        return Err(format!(
            "GetFileInformationByHandle failed for {path}: {}",
            unsafe { GetLastError() }
        ));
    }

    let file_index = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
    Ok((info.dwVolumeSerialNumber, file_index, info.nNumberOfLinks))
}

fn resolve_path_from_frn(
    frn: u64,
    drive: &str,
    map: &HashMap<u64, FrnNode>,
    cache: &mut HashMap<u64, String>,
) -> Option<String> {
    if let Some(value) = cache.get(&frn) {
        return Some(value.clone());
    }

    let mut parts: Vec<String> = Vec::new();
    let mut current = frn;
    let mut visited: HashSet<u64> = HashSet::new();

    for _ in 0..256 {
        if !visited.insert(current) {
            break;
        }

        let node = match map.get(&current) {
            Some(value) => value,
            None => break,
        };

        if !node.name.is_empty() {
            parts.push(node.name.clone());
        }

        if node.parent_frn == 0 || node.parent_frn == current {
            break;
        }

        current = node.parent_frn;
    }

    parts.reverse();

    let mut full = match normalize_drive(drive) {
        Ok(value) => value,
        Err(_) => return None,
    };
    if !parts.is_empty() {
        full.push_str(&parts.join("\\"));
    }

    cache.insert(frn, full.clone());
    Some(full)
}

fn parse_usn_records(
    buffer: &[u8],
    bytes_returned: usize,
    nodes: &mut HashMap<u64, FrnNode>,
    scanned: &mut u64,
    app: &AppHandle,
) -> Result<u64, String> {
    if bytes_returned < size_of::<u64>() {
        return Ok(0);
    }

    let mut next_frn_bytes = [0_u8; 8];
    next_frn_bytes.copy_from_slice(&buffer[0..8]);
    let next_start_frn = u64::from_le_bytes(next_frn_bytes);

    let mut offset = size_of::<u64>();

    while bytes_returned.saturating_sub(offset) >= size_of::<UsnRecordV2Header>() {
        let header_ptr = unsafe { buffer.as_ptr().add(offset) as *const UsnRecordV2Header };
        let header = unsafe { std::ptr::read_unaligned(header_ptr) };

        if header.record_length == 0 {
            break;
        }

        let record_len = header.record_length as usize;
        if record_len < size_of::<UsnRecordV2Header>() {
            break;
        }

        let record_end = match offset.checked_add(record_len) {
            Some(value) => value,
            None => break,
        };

        if record_end > bytes_returned {
            break;
        }

        if header.major_version == 2 {
            let name_start = match offset.checked_add(header.file_name_offset as usize) {
                Some(value) => value,
                None => break,
            };
            let name_len_bytes = header.file_name_length as usize;
            let name_end = match name_start.checked_add(name_len_bytes) {
                Some(value) => value,
                None => break,
            };

            if name_end <= record_end && name_len_bytes % 2 == 0 {
                let name_len_u16 = name_len_bytes / 2;
                let name_ptr = unsafe { buffer.as_ptr().add(name_start) as *const u16 };
                let name_slice = unsafe { std::slice::from_raw_parts(name_ptr, name_len_u16) };

                let name = String::from_utf16_lossy(name_slice);

                nodes.insert(
                    header.file_reference_number,
                    FrnNode {
                        parent_frn: header.parent_file_reference_number,
                        name,
                        file_attributes: header.file_attributes,
                    },
                );

                *scanned += 1;

                if *scanned % 1000 == 0 {
                    let _ = app.emit(
                        "scan:progress",
                        ScanProgress {
                            scanned: *scanned,
                            found: 0,
                            current_path: "USN journal".to_string(),
                        },
                    );
                }
            }
        }

        offset = record_end;
    }

    Ok(next_start_frn)
}

fn open_volume_handle(drive: &str) -> Result<OwnedHandle, String> {
    let normalized_drive = normalize_drive(drive)?;
    let volume = format!(r"\\.\{}", normalized_drive.trim_end_matches('\\'));
    let wide = to_wide_null(&volume);

    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ_ACCESS,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };

    let owned = OwnedHandle(handle);

    if !owned.is_valid() {
        return Err(format!(
            "CreateFileW failed for volume {volume}: {}",
            unsafe { GetLastError() }
        ));
    }

    Ok(owned)
}

fn scan_with_usn(drive: &str, app: &AppHandle) -> Result<Vec<LinkEntry>, String> {
    if !crate::elevation::is_elevated() {
        return Err("USN Journal requires elevated privileges".to_string());
    }

    let config = load_config()?;
    let volume = open_volume_handle(drive)?;

    let mut journal_data = UsnJournalDataV0::default();
    let mut bytes_returned = 0_u32;

    let ok = unsafe {
        DeviceIoControl(
            volume.0,
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null_mut(),
            0,
            &mut journal_data as *mut UsnJournalDataV0 as *mut c_void,
            size_of::<UsnJournalDataV0>() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        return Err(format!(
            "FSCTL_QUERY_USN_JOURNAL failed: {}",
            unsafe { GetLastError() }
        ));
    }

    let mut mft_enum_data = MftEnumDataV0 {
        start_file_reference_number: 0,
        low_usn: 0,
        high_usn: journal_data.next_usn,
    };

    let mut output_buffer = vec![0_u8; 1024 * 1024];
    let mut nodes: HashMap<u64, FrnNode> = HashMap::new();
    let mut scanned = 0_u64;

    loop {
        let mut returned = 0_u32;

        let ok = unsafe {
            DeviceIoControl(
                volume.0,
                FSCTL_ENUM_USN_DATA,
                &mut mft_enum_data as *mut MftEnumDataV0 as *mut c_void,
                size_of::<MftEnumDataV0>() as u32,
                output_buffer.as_mut_ptr() as *mut c_void,
                output_buffer.len() as u32,
                &mut returned,
                std::ptr::null_mut(),
            )
        };

        if ok == 0 {
            let code = unsafe { GetLastError() };

            if code == ERROR_HANDLE_EOF {
                break;
            }

            return Err(format!("FSCTL_ENUM_USN_DATA failed with error code {code}"));
        }

        if returned as usize <= size_of::<u64>() {
            break;
        }

        let next = parse_usn_records(
            &output_buffer,
            returned as usize,
            &mut nodes,
            &mut scanned,
            app,
        )?;

        if next == 0 || next == mft_enum_data.start_file_reference_number {
            break;
        }

        mft_enum_data.start_file_reference_number = next;
    }

    let mut entries: Vec<LinkEntry> = Vec::new();
    let mut cache: HashMap<u64, String> = HashMap::new();
    let mut seen_hardlinks: HashSet<(u32, u64)> = HashSet::new();
    let mut batch: Vec<LinkEntry> = Vec::with_capacity(SCAN_BATCH_SIZE);
    let mut found = 0_u64;
    let mut processed = 0_u64;

    for (frn, node) in &nodes {
        let path = match resolve_path_from_frn(*frn, drive, &nodes, &mut cache) {
            Some(value) => value,
            None => continue,
        };

        if should_exclude(Path::new(&path), &config.scan.excluded_paths) {
            continue;
        }

        processed += 1;

        if node.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            let tag = get_reparse_tag(&path).unwrap_or_default();
            let link_type = match tag {
                IO_REPARSE_TAG_MOUNT_POINT => LinkType::Junction,
                IO_REPARSE_TAG_SYMLINK => LinkType::Symlink,
                _ => LinkType::Symlink,
            };

            let target = fs::read_link(&path)
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();

            let entry = LinkEntry {
                path: path.clone(),
                target,
                link_type,
                status: LinkStatus::Ok,
            };
            batch.push(entry.clone());
            entries.push(entry);

            found += 1;
        } else if node.file_attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
            if let Ok((volume_serial, file_index, links_count)) = get_hardlink_info(&path) {
                if links_count > 1 && seen_hardlinks.insert((volume_serial, file_index)) {
                    let entry = LinkEntry {
                        path: path.clone(),
                        target: find_hardlink_target(Path::new(&path)),
                        link_type: LinkType::Hardlink,
                        status: LinkStatus::Ok,
                    };
                    batch.push(entry.clone());
                    entries.push(entry);

                    found += 1;
                }
            }
        }

        if batch.len() >= SCAN_BATCH_SIZE {
            emit_scan_batch(app, &mut batch);
        }

        if processed % 1000 == 0 {
            let _ = app.emit(
                "scan:progress",
                ScanProgress {
                    scanned,
                    found,
                    current_path: path,
                },
            );
        }
    }

    emit_scan_batch(app, &mut batch);

    Ok(entries)
}

fn collect_walkdir_entries<F, B>(
    root_path: &Path,
    excluded_paths: &[String],
    mut on_progress: F,
    mut on_batch: B,
) -> Vec<LinkEntry>
where
    F: FnMut(u64, u64, &Path),
    B: FnMut(Vec<LinkEntry>),
{
    let mut scanned = 0_u64;
    let mut found = 0_u64;
    let mut entries: Vec<LinkEntry> = Vec::new();
    let mut seen_hardlinks: HashSet<(u32, u64)> = HashSet::new();
    let mut batch: Vec<LinkEntry> = Vec::with_capacity(SCAN_BATCH_SIZE);

    for item in WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = item.path().to_path_buf();

        if should_exclude(&path, excluded_paths) {
            continue;
        }

        scanned += 1;

        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let file_type = metadata.file_type();

        if file_type.is_symlink() {
            let target = fs::read_link(&path)
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            let link_type = map_symlink_type(&path, &target);

            let entry = LinkEntry {
                path: path.to_string_lossy().to_string(),
                target,
                link_type,
                status: LinkStatus::Ok,
            };
            batch.push(entry.clone());
            entries.push(entry);

            found += 1;
        } else if !metadata.is_dir() {
            let path_text = path.to_string_lossy().to_string();

            if let Ok((volume_serial, file_index, links_count)) = get_hardlink_info(&path_text) {
                if links_count > 1 && seen_hardlinks.insert((volume_serial, file_index)) {
                    let entry = LinkEntry {
                        path: path_text.clone(),
                        target: find_hardlink_target(&path),
                        link_type: LinkType::Hardlink,
                        status: LinkStatus::Ok,
                    };
                    batch.push(entry.clone());
                    entries.push(entry);

                    found += 1;
                }
            }
        }

        if batch.len() >= SCAN_BATCH_SIZE {
            on_batch(std::mem::take(&mut batch));
        }

        if scanned % 500 == 0 {
            on_progress(scanned, found, &path);
        }
    }

    if !batch.is_empty() {
        on_batch(batch);
    }

    entries
}

#[allow(dead_code)]
pub fn scan_path_with_walkdir_for_tests(path: &str) -> Result<Vec<LinkEntry>, String> {
    let root_path = PathBuf::from(path);

    if !root_path.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    Ok(collect_walkdir_entries(
        &root_path,
        &[],
        |_scanned, _found, _current_path| {},
        |_batch| {},
    ))
}

fn scan_with_walkdir(drive: &str, app: &AppHandle) -> Result<Vec<LinkEntry>, String> {
    let config = load_config()?;
    let root = normalize_drive(drive)?;
    let root_path = PathBuf::from(&root);

    if !root_path.exists() {
        return Err(format!("Volume path does not exist: {root}"));
    }

    let entries = collect_walkdir_entries(
        &root_path,
        &config.scan.excluded_paths,
        |scanned, found, current_path| {
            let _ = app.emit(
                "scan:progress",
                ScanProgress {
                    scanned,
                    found,
                    current_path: current_path.to_string_lossy().to_string(),
                },
            );
        },
        |batch| {
            let _ = app.emit("scan:batch", ScanBatch { entries: batch });
        },
    );

    Ok(entries)
}

#[tauri::command]
pub async fn scan_volume(drive: String, app: AppHandle) -> Result<ScanResult, String> {
    let normalized_drive = normalize_drive(&drive)?;
    let drive_for_scan = normalized_drive.clone();
    let app_for_scan = app.clone();

    let try_usn = tokio::task::spawn_blocking(move || scan_with_usn(&drive_for_scan, &app_for_scan))
        .await
        .map_err(|e| format!("USN task join error: {e}"))?;

    match try_usn {
        Ok(entries) => Ok(ScanResult {
            entries,
            mode: ScanMode::UsnJournal,
        }),
        Err(_) => {
            let drive_fallback = normalized_drive;
            let entries = tokio::task::spawn_blocking(move || scan_with_walkdir(&drive_fallback, &app))
                .await
                .map_err(|e| format!("walkdir task join error: {e}"))??;

            Ok(ScanResult {
                entries,
                mode: ScanMode::WalkdirFallback,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_drive, should_exclude};
    use std::path::Path;

    #[test]
    fn normalize_drive_accepts_expected_forms() {
        assert_eq!(normalize_drive("c:").unwrap(), "C:\\");
        assert_eq!(normalize_drive("D:\\").unwrap(), "D:\\");
        assert_eq!(normalize_drive(" e:/ ").unwrap(), "E:\\");
    }

    #[test]
    fn normalize_drive_rejects_unsafe_forms() {
        assert!(normalize_drive("C:\\Windows").is_err());
        assert!(normalize_drive("..\\").is_err());
        assert!(normalize_drive("\\\\.\\PhysicalDrive0").is_err());
    }

    #[test]
    fn exclude_prefix_must_match_path_boundary() {
        assert!(should_exclude(
            Path::new("C:\\data\\archive\\item.txt"),
            &["C:\\data\\archive".to_string()]
        ));

        assert!(!should_exclude(
            Path::new("C:\\data\\archives\\item.txt"),
            &["C:\\data\\archive".to_string()]
        ));
    }
}
