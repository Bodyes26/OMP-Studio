//! Scritture atomiche su file di configurazione dell'utente.
//!
//! Tutto quello che Studio riscrive fuori dal proprio stato (config di `omp`,
//! profili di shell, coda dei task) passa da qui: si scrive un temporaneo
//! nella stessa directory, si forza il flush su disco e solo allora si
//! sostituisce la destinazione. Cosi' un errore o un'interruzione lascia
//! intatto il file precedente, invece di troncarlo a meta'.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Temporaneo nella stessa directory della destinazione: un `rename` tra
/// filesystem diversi non sarebbe atomico.
fn create_temp_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "percorso senza directory"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "percorso senza nome file"))?
        .to_string_lossy();

    loop {
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".{}.{}.{}.tmp",
            file_name,
            std::process::id(),
            counter
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn replace_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    // Su POSIX `rename` sostituisce atomicamente anche una destinazione
    // esistente.
    fs::rename(temp_path, target_path)
}

/// Windows non consente a `rename` di sovrascrivere: `ReplaceFileW` fa lo
/// scambio conservando la destinazione fino all'ultimo istante utile.
#[cfg(target_os = "windows")]
pub(crate) fn replace_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }

    if !target_path.exists() {
        return match fs::rename(temp_path, target_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                replace_file(temp_path, target_path)
            }
            Err(error) => Err(error),
        };
    }

    let target: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temp: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            temp.as_ptr(),
            std::ptr::null(),
            0x0000_0001, // REPLACEFILE_WRITE_THROUGH
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Scrive `contents` su `path` senza mai lasciare il file a metà. In caso di
/// errore il temporaneo viene rimosso e la destinazione resta quella di prima.
pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let (temp_path, mut temp_file) = create_temp_file(path)
        .map_err(|error| format!("Creazione temp {}: {}", path.display(), error))?;
    let result = (|| -> io::Result<()> {
        temp_file.write_all(contents)?;
        temp_file.flush()?;
        temp_file.sync_all()?;
        drop(temp_file);
        replace_file(&temp_path, path)
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Scrittura atomica {}: {}", path.display(), error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "omp-studio-atomic-{}-{}-{}",
            label,
            std::process::id(),
            counter
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("creazione directory di test");
        path
    }

    #[test]
    fn sostituisce_il_contenuto_e_non_lascia_temporanei() {
        let dir = temp_dir("replace");
        let target = dir.join("config.yml");
        fs::write(&target, b"vecchio").unwrap();

        atomic_write(&target, b"nuovo").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"nuovo");
        let residui: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(residui.is_empty(), "temporaneo rimasto sul disco");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn crea_il_file_quando_non_esiste() {
        let dir = temp_dir("create");
        let target = dir.join("nuovo.json");

        atomic_write(&target, b"{}").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"{}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn una_destinazione_impossibile_non_tocca_niente() {
        let dir = temp_dir("failure");
        // La directory genitore non esiste: la creazione del temporaneo
        // fallisce e nessun file viene scritto.
        let target = dir.join("assente").join("config.yml");

        let error = atomic_write(&target, b"x").unwrap_err();

        assert!(error.contains("Creazione temp"), "errore inatteso: {}", error);
        assert!(!target.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
