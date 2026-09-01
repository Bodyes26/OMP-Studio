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
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Temporaneo nella stessa directory della destinazione: un `rename` tra
/// filesystem diversi non sarebbe atomico.
/// Su Unix il file temporaneo viene creato con modo restrittivo 0600
/// (lettura e scrittura solo per il proprietario).
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
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);

        match options.open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn replace_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    // Se la destinazione esiste gia', ne preserviamo i permessi originali sul
    // file temporaneo prima dello swap. Se il target esiste ma non e' possibile
    // leggere o applicare i suoi permessi, propaghiamo l'errore (fail-closed)
    // invece di procedere con permessi errati.
    #[cfg(unix)]
    match fs::metadata(target_path) {
        Ok(metadata) => {
            fs::set_permissions(temp_path, metadata.permissions())?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

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

    #[test]
    fn fallimento_replace_pulisce_il_temporaneo() {
        let dir = temp_dir("replace-fail");
        let target = dir.join("target_dir");
        fs::create_dir(&target).expect("creazione directory target");

        let res = atomic_write(&target, b"data");
        assert!(res.is_err(), "la sostituzione su directory deve fallire");

        let residui: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(residui.is_empty(), "il file temporaneo deve essere rimosso in caso di fallimento");
        assert!(target.is_dir(), "la directory di destinazione deve restare intatta");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_preserva_permessi_0600_su_target_esistente() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perm-0600");
        let target = dir.join("config.json");
        fs::write(&target, b"vecchio").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();

        atomic_write(&target, b"nuovo").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"nuovo");
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "i permessi 0600 devono essere preservati");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_preserva_altro_modo_su_target_esistente() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perm-altro");
        let target = dir.join("config.yml");
        fs::write(&target, b"vecchio").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).unwrap();

        atomic_write(&target, b"nuovo").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"nuovo");
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644, "i permessi 0644 devono essere preservati");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_nuovo_file_creato_con_modo_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perm-new");
        let target = dir.join("nuovo.json");

        atomic_write(&target, b"{\"created\": true}").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"{\"created\": true}");
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "i nuovi file devono avere modo 0600");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_fallimento_replace_pulisce_il_temporaneo() {
        let dir = temp_dir("unix-replace-failure");
        let target = dir.join("directory_target");
        fs::create_dir(&target).unwrap();

        let result = atomic_write(&target, b"contenuto");
        assert!(result.is_err(), "la scrittura atomica su una directory deve fallire");

        let prefix = format!(".directory_target.{}.", std::process::id());
        let residui: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
            .collect();
        assert!(residui.is_empty(), "il file temporaneo deve essere rimosso in caso di fallimento del replace");
        assert!(target.is_dir(), "la directory di destinazione deve rimanere intatta");
        let _ = fs::remove_dir_all(&dir);
    }
}
