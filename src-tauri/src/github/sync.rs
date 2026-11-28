use serde::{Deserialize, Serialize};
use std::io::Read;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpstreamStatus {
    pub is_git: bool,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub incoming_commits: Vec<CommitSummary>,
    pub outgoing_commits: Vec<CommitSummary>,
    pub has_uncommitted: bool,
    /// Identità del repository condivisa fra le macchine (R-MI-12): `owner/repo`
    /// in minuscolo quando l'origin è GitHub, altrimenti `None`. Due copie con
    /// la stessa identità sono lo stesso progetto, anche su sistemi diversi.
    /// Viaggia con questo comando perché è già instradato e in cache per
    /// progetto: una seconda chiamata git per ogni tessera sarebbe sprecata.
    pub repo_slug: Option<String>,
    /// Primo commit del repository: identifica le copie senza origin condiviso.
    pub root_commit: Option<String>,
    /// Commit corrente della copia: due copie sullo stesso branch con HEAD
    /// diversi divergono (R-MI-22). Gratis da `branch.oid`, nessun git in più.
    #[serde(default)]
    pub head_commit: Option<String>,
    /// File con modifiche non committate, per il riassunto della divergenza.
    #[serde(default)]
    pub changed_files: u32,
}

pub(crate) fn run_git_in(dir: &Path, args: &[&str]) -> Result<String, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(args);
    // Le letture in polling (status, rev-list, for-each-ref) non devono
    // contendere `index.lock` con gli agenti che committano nello stesso
    // repository (S8-08); fetch, push e pull lo lasciano.
    if read_only(args) {
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| {
            crate::tr!(
                format!("Esecuzione git {:?} fallita: {e}", args),
                format!("Running git {:?} failed: {e}", args)
            )
        })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Comandi git che leggono soltanto. `GIT_OPTIONAL_LOCKS=0` vale per loro: le
/// letture non hanno nulla da aggiornare e non devono prendere l'indice.
fn read_only(args: &[&str]) -> bool {
    match args.first().copied() {
        Some("cat-file" | "diff" | "for-each-ref" | "log" | "ls-files" | "merge-base" | "rev-list"
            | "rev-parse" | "show" | "status" | "symbolic-ref") => true,
        // `remote get-url` legge, `remote add`/`remote remove` scrivono.
        Some("remote") => matches!(args.get(1).copied(), Some("get-url")),
        _ => false,
    }
}

/// Esito grezzo di un comando git: serve quando anche un exit 0 va interpretato
/// (un pull che lascia un rebase a meta' non cambia il codice di uscita).
struct GitRawOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl GitRawOutput {
    fn combined(&self) -> String {
        let mut text = self.stdout.trim().to_string();
        let err = self.stderr.trim();
        if !err.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(err);
        }
        text
    }
}

/// Esegue git con messaggi in inglese (LC_ALL/LANGUAGE=C), cosi' un errore
/// riportato all'utente non cambia lingua a meta' frase con le impostazioni
/// di sistema.
fn run_git_raw(dir: &Path, args: &[&str]) -> Result<GitRawOutput, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(args);
    cmd.env("LC_ALL", "C");
    cmd.env("LANGUAGE", "C");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.stdin(std::process::Stdio::null());
    if read_only(args) {
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd
        .output()
        .map_err(|e| {
            crate::tr!(
                format!("Esecuzione git {:?} fallita: {e}", args),
                format!("Running git {:?} failed: {e}", args)
            )
        })?;
    Ok(GitRawOutput {
        success: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}

/// Vero se nella gitdir del worktree e' rimasto un rebase interrotto.
/// `--git-path` risolve la gitdir giusta anche per i worktree collegati.
fn rebase_in_progress(dir: &Path) -> bool {
    ["rebase-merge", "rebase-apply"].iter().any(|name| {
        run_git_in(dir, &["rev-parse", "--git-path", name])
            .map(|raw| {
                let candidate = Path::new(raw.trim());
                let full = if candidate.is_absolute() {
                    candidate.to_path_buf()
                } else {
                    dir.join(candidate)
                };
                full.exists()
            })
            .unwrap_or(false)
    })
}

/// File che bloccano un pull fallito. Con un'unione ferma li da' l'indice
/// (`--diff-filter=U`); con un rebase fermo git li nomina in una riga
/// `CONFLICT (content): Merge conflict in <file>`, perche' in quel momento
/// nell'indice non ci sono ancora. Si legge prima di annullare: dopo
/// `merge --abort` / `rebase --abort` non c'e' piu' niente da leggere.
fn unmerged_files(dir: &Path, output: &str) -> Vec<String> {
    let mut files: Vec<String> = run_git_in(dir, &["diff", "--name-only", "--diff-filter=U", "-z"])
        .map(|raw| raw.split('\0').filter(|name| !name.is_empty()).map(str::to_owned).collect())
        .unwrap_or_default();
    for line in output.lines() {
        let Some((_, rest)) = line.split_once("Merge conflict in ") else { continue };
        let name = rest.trim().trim_end_matches(['.', '\'']);
        if !name.is_empty() { files.push(name.to_owned()); }
    }
    files.sort_unstable();
    files.dedup();
    files
}

/// Pull che non lascia mai il repository a meta' (R-MI-71).
///
/// La versione precedente usava `git pull --rebase --autostash`: con un
/// conflitto lasciava i marcatori nei file e le modifiche locali nello stash
/// (caso del 28/11: `CHANGELOG.md` in conflitto). Qui le modifiche non
/// committate si mettono da parte con lo stesso meccanismo a istantanea di
/// R-MI-47 (indice temporaneo, commit temporaneo, nessuno stash), la cartella
/// resta pulita per il rebase, e alla fine l'istantanea si riapplica a tre vie.
/// Se la riapplicazione confligge si torna esattamente allo stato iniziale —
/// ramo compreso — e l'errore nomina i file che bloccano.
///
/// `ff_only` e' l'azione «Aggiorna» delle copie indietro (R-MI-58): si accetta
/// solo il fast-forward, mai un rebase; le modifiche non committate che i
/// commit in arrivo non toccano restano comunque dove sono.
fn pull_with_snapshot(dir: &Path, ff_only: bool) -> Result<String, String> {
    // Un rebase gia' in corso e' dell'utente: toccarlo butterebbe via i
    // conflitti che sta risolvendo.
    if rebase_in_progress(dir) {
        return Err(crate::tr!(
            "Pull non eseguito: nel repository c'è già un rebase in corso. Completalo o annullalo prima di sincronizzare.",
            "Pull not run: a rebase is already in progress in the repository. Complete or abort it before syncing."
        )
        .to_string());
    }
    if run_git_in(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).is_err() {
        return Err(crate::tr!(
            "Pull non eseguito: la copia non è su una branch.",
            "Pull not run: the copy is not on a branch."
        )
        .to_string());
    }
    let snapshot = crate::github::copies::local_snapshot(dir)?;
    // Le modifiche locali non viaggiano nello stash: sono gia' nel commit
    // temporaneo, quindi la cartella resta pulita per il rebase. Se lo
    // svuotamento si ferma a meta' il repository torna com'era: da qui in poi
    // ogni uscita passa da `restore_local_snapshot` (R-MI-71).
    if let Some(snapshot) = &snapshot {
        if let Err(error) = crate::github::copies::clear_worktree(dir, snapshot) {
            let _ = crate::github::copies::restore_local_snapshot(dir, snapshot);
            return Err(error);
        }
    }
    // La scelta e' esplicita: `pull.ff` e `pull.rebase` dell'utente non
    // decidono al posto nostro. Serve `pull.ff=false`, non `allow`: git
    // accetta solo `true`/`false`/`only` in configurazione, e `allow` — che
    // vale come opzione — qui verrebbe rifiutato. `autoStash=false` impedisce a
    // git di rimettere qualcosa nello stash (il caso del 28/11): la cartella e'
    // gia' pulita, quindi non c'e' niente da mettere da parte.
    let mut args = vec!["-c", "rebase.autoStash=false", "-c", "merge.autoStash=false", "-c", "pull.ff=false"];
    args.extend(if ff_only { ["pull", "--ff-only"] } else { ["pull", "--rebase"] });
    let outcome = run_git_raw(dir, &args);
    // Unione con conflitti: si annulla prima di riportare la cartella com'era,
    // cosi' non restano ne' marcatori ne' `MERGE_HEAD`. I file in conflitto si
    // leggono prima: dopo `merge --abort` / `rebase --abort` l'informazione
    // non c'e' piu' (R-MI-71).
    let failed = match &outcome {
        Ok(out) if out.success => None,
        Ok(out) => {
            let combined = out.combined();
            let conflicts = unmerged_files(dir, &combined);
            let _ = run_git_raw(dir, &["merge", "--abort"]);
            let _ = run_git_raw(dir, &["rebase", "--abort"]);
            Some((combined, conflicts))
        }
        Err(error) => Some((error.clone(), Vec::new())),
    };
    // Sul pull riuscito si riapplica l'istantanea sul nuovo HEAD.
    let blocking = match (&failed, &snapshot) {
        (None, Some(snapshot)) => crate::github::copies::reapply_local_snapshot(dir, snapshot).err(),
        _ => None,
    };
    if failed.is_some() || blocking.is_some() {
        // In ogni caso il repository torna esattamente com'era (R-MI-71).
        if let Some(snapshot) = &snapshot { let _ = crate::github::copies::restore_local_snapshot(dir, snapshot); }
    }
    if let Some(files) = blocking {
        if files.is_empty() {
            return Err(crate::tr!(
                "Pull annullato: le modifiche locali non si riapplicano. Il repository è com'era.",
                "Pull cancelled: the local changes could not be reapplied. The repository is as it was."
            ).to_string());
        }
        // Errore strutturato: il frontend lo mostra con i file che bloccano.
        let tail = failed.as_ref().map(|(text, _)| text.as_str()).unwrap_or_default();
        return Err(format!("blocked_by_local_changes:{}\n{tail}", files.join(",")));
    }
    if let Some((text, conflicts)) = failed {
        // Un conflitto vero fra i due lati non e' «modifiche locali»: il
        // messaggio di git pero' e' lungo e in inglese, quindi si antepone
        // l'elenco dei file che bloccano in una riga sola.
        if !conflicts.is_empty() {
            let files = conflicts.join(", ");
            return Err(crate::tr!(
                format!("Pull annullato: conflitto su {files}. Il repository è com'era.\n{text}"),
                format!("Pull cancelled: conflict on {files}. The repository is as it was.\n{text}")
            ).to_string());
        }
        return Err(if text.trim().is_empty() { crate::tr!("Pull non riuscito", "Pull failed").to_string() } else { text });
    }
    let out = outcome.expect("esito del pull");
    let stdout = out.stdout.trim();
    Ok(if stdout.is_empty() {
        crate::tr!("Pull completato", "Pull completed").to_string()
    } else {
        stdout.to_string()
    })
}

fn append_batch_mode_flag(cmd: &str) -> String {
    let lower = cmd.to_lowercase();
    // Se ha già BatchMode=yes o -batch (plink/tortoise), non duplicare
    if lower.contains("batchmode=yes") || lower.contains("-batch") {
        return cmd.to_string();
    }

    if lower.contains("plink") {
        format!("{cmd} -batch")
    } else {
        format!("{cmd} -o BatchMode=yes")
    }
}

fn resolve_ssh_batch_command(dir: &Path) -> String {
    // 1. Controlla la variabile d'ambiente GIT_SSH_COMMAND
    let env_ssh_cmd = std::env::var("GIT_SSH_COMMAND").ok().and_then(|val| {
        let trimmed = val.trim().to_string();
        if !trimmed.is_empty() {
            Some(trimmed)
        } else {
            None
        }
    });

    // 2. Se assente, controlla la configurazione git core.sshCommand (locale o globale)
    let git_cfg_ssh = env_ssh_cmd.or_else(|| {
        run_git_in(dir, &["config", "--get", "core.sshCommand"])
            .ok()
            .and_then(|val| {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    Some(trimmed)
                } else {
                    None
                }
            })
    });

    // 3. Se assente, controlla GIT_SSH
    let base_cmd = git_cfg_ssh.or_else(|| {
        std::env::var("GIT_SSH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|path| format!("\"{path}\""))
    });

    match base_cmd {
        Some(cmd) => append_batch_mode_flag(&cmd),
        None => "ssh -o BatchMode=yes".to_string(),
    }
}

fn run_git_fetch_background_with_timeout(dir: &Path, timeout: Duration) -> Result<String, String> {
    let ssh_cmd = resolve_ssh_batch_command(dir);
    let ssh_cfg_arg = format!("core.sshCommand={ssh_cmd}");
    let args = ["-c", &ssh_cfg_arg, "fetch", "--prune"];
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));

    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "Never");
    cmd.env("GIT_SSH_COMMAND", &ssh_cmd);
    cmd.env("GIT_ASKPASS", "");
    cmd.env("SSH_ASKPASS", "");
    cmd.env("SSH_ASKPASS_REQUIRE", "never");
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            crate::tr!(
                format!("Esecuzione git fetch in background fallita: {e}"),
                format!("Background git fetch could not start: {e}")
            )
        })?;

    let pid = child.id();
    #[cfg(target_os = "windows")]
    let job = crate::process_tree::WindowsJob::create_for_process(pid).ok();

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();

    let _stdout_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stdout_tx.send(buf);
    });

    let _stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stderr_tx.send(buf);
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    #[cfg(target_os = "windows")]
                    crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
                    #[cfg(not(target_os = "windows"))]
                    crate::process_tree::kill_process_tree(Some(pid));
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                #[cfg(target_os = "windows")]
                crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
                #[cfg(not(target_os = "windows"))]
                crate::process_tree::kill_process_tree(Some(pid));
                let _ = child.kill();
                let _ = child.wait();
                return Err(crate::tr!(
                    format!("Attesa processo git fetch in background fallita: {e}"),
                    format!("Waiting for the background git fetch failed: {e}")
                ));
            }
        }
    };

    if timed_out {
        return Err(crate::tr!(
            format!(
                "Operazione git fetch in background terminata per timeout ({}s)",
                timeout.as_secs()
            ),
            format!(
                "Background git fetch timed out after {}s",
                timeout.as_secs()
            )
        ));
    }

    let status = status.ok_or_else(|| {
        crate::tr!(
            "Processo git terminato in modo anomalo",
            "The git process ended abnormally"
        )
        .to_string()
    })?;

    // Un helper che eredita i pipe non deve trasformare un fetch fallito in un successo.
    let drain_timeout =
        Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now()));
    let output = stdout_rx.recv_timeout(drain_timeout).and_then(|stdout| {
        let remaining =
            Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now()));
        stderr_rx
            .recv_timeout(remaining)
            .map(|stderr| (stdout, stderr))
    });
    let (stdout_bytes, stderr_bytes) = match output {
        Ok(output) => output,
        Err(error) => {
            #[cfg(target_os = "windows")]
            crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
            #[cfg(not(target_os = "windows"))]
            crate::process_tree::kill_process_tree(Some(pid));
            return Err(crate::tr!(
                format!("Lettura output git fetch in background fallita: {error}"),
                format!("Reading the background git fetch output failed: {error}")
            ));
        }
    };

    if !status.success() {
        let err = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
        let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }

    let out = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
    Ok(if out.is_empty() {
        crate::tr!("Fetch completato con successo", "Fetch completed successfully").to_string()
    } else {
        out
    })
}

fn run_git_fetch_background(dir: &Path) -> Result<String, String> {
    const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
    run_git_fetch_background_with_timeout(dir, DEFAULT_TIMEOUT)
}

fn parse_commit_log(raw: &str) -> Vec<CommitSummary> {
    let mut list = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() >= 5 {
            list.push(CommitSummary {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                subject: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            });
        }
    }
    list
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GitPorcelainV2BranchInfo {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub has_uncommitted: bool,
    pub head_commit: Option<String>,
    pub changed_files: u32,
}

/// Parsing di `git status --porcelain=v2 --branch`.
/// Le righe header iniziano con '# ':
/// - '# branch.head <head>' indica il branch corrente o '(detached)'
/// - '# branch.upstream <upstream>' indica il branch remoto tracciato
/// - '# branch.ab +<ahead> -<behind>' indica il disallineamento numerico
///
/// Qualsiasi riga non vuota che non inizi con '#' rappresenta modifiche
/// al working tree (modificati, untracked, conflitti, rinomine).
pub(crate) fn parse_porcelain_v2_branch(raw: &str) -> GitPorcelainV2BranchInfo {
    let mut branch = String::new();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut has_uncommitted = false;
    let mut head_commit = None;
    let mut changed_files = 0u32;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix('#') {
            let header = rest.trim_start();
            if let Some(oid) = header.strip_prefix("branch.oid ") {
                // `(initial)` su un repository senza commit: nessun HEAD.
                let oid = oid.trim();
                if !oid.is_empty() && !oid.starts_with('(') {
                    head_commit = Some(oid.to_string());
                }
            } else if let Some(b) = header.strip_prefix("branch.head ") {
                branch = b.trim().to_string();
            } else if let Some(u) = header.strip_prefix("branch.upstream ") {
                let u_clean = u.trim();
                if !u_clean.is_empty() {
                    upstream = Some(u_clean.to_string());
                }
            } else if let Some(ab) = header.strip_prefix("branch.ab ") {
                for part in ab.split_whitespace() {
                    if let Some(a) = part.strip_prefix('+') {
                        ahead = a.parse::<u32>().unwrap_or(0);
                    } else if let Some(b) = part.strip_prefix('-') {
                        behind = b.parse::<u32>().unwrap_or(0);
                    }
                }
            }
        } else {
            // Qualsiasi voce fuori dagli header (#) segnala file modificati,
            // aggiunti, rimossi o untracked nel working tree
            has_uncommitted = true;
            changed_files += 1;
        }
    }

    if branch.is_empty() {
        branch = "HEAD".to_string();
    }

    GitPorcelainV2BranchInfo {
        branch,
        upstream,
        ahead,
        behind,
        has_uncommitted,
        head_commit,
        changed_files,
    }
}

/// Identità del repository: l'origin GitHub normalizzato, altrimenti il primo
/// commit (R-MI-12). Serve anche a trovare la copia dello stesso progetto su
/// un'altra macchina (R-MI-36).
///
/// Il valore non cambia quasi mai ma i tre git che lo leggono costano (~40 ms
/// su una storia lunga) e `git_upstream_status` arriva ogni pochi secondi da
/// due finestre e dal peer: si tiene per percorso canonico, con l'mtime di
/// `.git/config` e `shallow` come chiave di validita' (S2-04, S8-11), e una
/// sola lettura per volta per lo stesso percorso.
pub(crate) fn repo_identity(path: &Path) -> (Option<String>, Option<String>) {
    let as_text = path.to_string_lossy();
    let key = crate::projects::canonical_project_base(&as_text)
        .map(|base| base.to_string_lossy().to_string())
        .unwrap_or_else(|_| as_text.to_string());
    let stamp = identity_stamp(path);
    if let Some(entry) = IDENTITY_CACHE.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
        if entry.stamp == stamp && entry.taken.elapsed() < IDENTITY_TTL { return entry.identity; }
    }
    let identity = identity_read(path);
    if let Ok(mut cache) = IDENTITY_CACHE.lock() {
        if cache.len() >= IDENTITY_CAP { cache.clear(); }
        cache.insert(key, IdentityEntry { stamp, taken: Instant::now(), identity: identity.clone() });
    }
    identity
}

/// Lettura vera dell'identita': tre git, nessuno sul percorso caldo.
fn identity_read(path: &Path) -> (Option<String>, Option<String>) {
    let repo_slug = run_git_in(path, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|url| crate::github::repos::parse_github_url(&url))
        .map(|(owner, repo)| format!("{}/{}", owner.to_lowercase(), repo.to_lowercase()));
    // Il primo commit identifica le copie senza origin solo se il repo e'
    // completo: su un clone shallow `rev-list --max-parents=0` restituisce
    // il confine shallow e non la vera radice, e due cloni con profondita'
    // diverse otterrebbero identita' diverse (M3).
    let root_commit = if run_git_in(path, &["rev-parse", "--is-shallow-repository"])
        .map(|out| out.trim() == "true")
        .unwrap_or(false)
    {
        None
    } else {
        run_git_in(path, &["rev-list", "--max-parents=0", "HEAD"])
            .ok()
            .and_then(|out| out.lines().next().map(|line| line.trim().to_owned()))
            .filter(|commit| !commit.is_empty())
    };
    (repo_slug, root_commit)
}

/// Quanto vale una voce senza che nessuno la rinfreschi: il single-flight
/// chiede «questo esito vale per tutti i chiamanti», non «per sempre».
const IDENTITY_TTL: Duration = Duration::from_secs(2);
/// Oltre questo numero di repository la cache si svuota: la mappa cresce con i
/// progetti aperti e chiusi di una sessione lunga.
const IDENTITY_CAP: usize = 64;

#[derive(Clone)]
struct IdentityEntry {
    stamp: IdentityStamp,
    taken: Instant,
    identity: (Option<String>, Option<String>),
}

/// Impronta dei file che cambiano l'identita': mtime in nanosecondi epoch.
type IdentityStamp = [u128; 3];

static IDENTITY_CACHE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, IdentityEntry>>> =
    std::sync::LazyLock::new(Default::default);

/// Istante dell'ultima modifica di `.git/config`, `.git/shallow` e `.git/HEAD`:
/// sono i tre file che cambiano l'identita' del repository (origin, clone
/// shallow, radice dei commit). Un percorso che non e' un repository lascia
/// zeri, e allora vale solo il TTL.
fn identity_stamp(path: &Path) -> IdentityStamp {
    let git_dir = path.join(".git");
    let nanos = |name: &str| std::fs::metadata(git_dir.join(name)).and_then(|meta| meta.modified()).ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_nanos())
        .unwrap_or(0);
    [nanos("config"), nanos("shallow"), nanos("HEAD")]
}

#[tauri::command]
pub async fn git_upstream_status(project_path: String) -> Result<GitUpstreamStatus, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&project_path);
        if !path.exists() {
            return Err(crate::tr!(
                format!("Percorso '{project_path}' non trovato"),
                format!("Path '{project_path}' not found")
            ));
        }

        // Singolo spawn git: `status --porcelain=v2 --branch` restituisce
        // in una sola chiamata se il path e' un repo git, il branch corrente,
        // l'upstream, ahead/behind e la presenza di modifiche locali.
        // Riduce da 5 a 1 i processi git creati ogni ciclo di polling.
        let status_raw = match run_git_in(path, &["status", "--porcelain=v2", "--branch"]) {
            Ok(out) => out,
            Err(_) => {
                return Ok(GitUpstreamStatus {
                    is_git: false,
                    branch: String::new(),
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    incoming_commits: Vec::new(),
                    outgoing_commits: Vec::new(),
                    has_uncommitted: false,
                    repo_slug: None,
                    root_commit: None,
                    head_commit: None,
                    changed_files: 0,
                });
            }
        };

        let parsed = parse_porcelain_v2_branch(&status_raw);
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();

        if parsed.upstream.is_some() {
            // Se ci sono commit incoming
            if parsed.behind > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) =
                    run_git_in(path, &["log", format_arg, "HEAD..@{u}", "-n", "10"])
                {
                    incoming = parse_commit_log(&raw_log);
                }
            }

            // Se ci sono commit outgoing
            if parsed.ahead > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) =
                    run_git_in(path, &["log", format_arg, "@{u}..HEAD", "-n", "10"])
                {
                    outgoing = parse_commit_log(&raw_log);
                }
            }
        }

        let (repo_slug, root_commit) = repo_identity(path);

        Ok(GitUpstreamStatus {
            is_git: true,
            branch: parsed.branch,
            upstream: parsed.upstream,
            ahead: parsed.ahead,
            behind: parsed.behind,
            incoming_commits: incoming,
            outgoing_commits: outgoing,
            has_uncommitted: parsed.has_uncommitted,
            repo_slug,
            root_commit,
            head_commit: parsed.head_commit,
            changed_files: parsed.changed_files,
        })
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Lettura dello stato upstream interrotta: {e}"),
            format!("Reading the upstream status was interrupted: {e}")
        )
    })?
}


#[tauri::command]
pub async fn git_sync_repo(project_path: String, action: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&project_path);
        if !path.exists() {
            return Err(crate::tr!(
                format!("Percorso '{project_path}' non trovato"),
                format!("Path '{project_path}' not found")
            ));
        }

        // R-MI-59/R-MI-72: ogni operazione git di Studio che puo' unire o
        // riapplicare (pull, rebase, merge, stash) trova il diario, i changelog
        // e i documenti di progetto gia' in unione per righe. Anche
        // `fetch-background`, cosi' ogni repository la riceve entro un giro. Se
        // gli attributi non si possono scrivere (`.git` in sola lettura) si
        // prosegue: non e' una condizione per lavorare.
        let _ = crate::github::copies::ensure_journal_union(path);

        let act = action.trim().to_lowercase();
        if act != "fetch"
            && act != "fetch-background"
            && crate::automations::is_project_locked(&project_path, None)
        {
            return Err(crate::tr!(
                format!(
                    "Operazione git sync non consentita: il progetto '{}' e' occupato da un'automazione attiva (AUT-042)",
                    project_path
                ),
                format!(
                    "git sync not allowed: project '{}' is busy with a running automation (AUT-042)",
                    project_path
                )
            ));
        }
        // Le azioni che spostano HEAD o il working tree passano dalla stessa
        // guardia del giro delle copie: un avanzamento delle copie e una
        // «Sincronizza» simultanei sullo stesso repository si sfarinano su
        // `index.lock`, e R-MI-71 non potrebbe piu' garantire il ritorno allo
        // stato di prima. La guardia si prende dopo il controllo delle
        // automazioni, come fa `copy_sync`, cosi' l'ordine dei due lock e'
        // sempre lo stesso e non c'e' attesa circolare.
        let _guard = if matches!(act.as_str(), "pull" | "pull-ff" | "sync") {
            match crate::github::copies::SyncGuard::acquire_waiting(&project_path)? {
                Some(guard) => Some(guard),
                // Il giro delle copie dura poche centinaia di millisecondi e
                // qui si e' gia' aspettato il suo tempo: si dice all'utente di
                // riprovare invece di restituire l'errore di git.
                None => return Err(crate::tr!(
                    "Operazione Git già in corso per questo progetto: riprova fra un istante.",
                    "Another Git operation is already running for this project: retry in a moment."
                ).to_string()),
            }
        } else { None };
        match act.as_str() {
            "fetch" => {
                run_git_in(path, &["fetch", "--prune"])?;
                Ok(crate::tr!(
                    "Fetch completato con successo",
                    "Fetch completed successfully"
                )
                .to_string())
            }
            "fetch-background" => run_git_fetch_background(path),
            // R-MI-71: anche «Aggiorna» (solo fast-forward) non lascia mai il
            // repository a meta'. Le modifiche non committate che i commit in
            // arrivo non toccano restano dove sono; quelle che li toccano
            // passano dall'istantanea e, se la riapplicazione confligge, il
            // repository torna com'era con i file che bloccano nel messaggio.
            "pull-ff" => pull_with_snapshot(path, true),
            "pull" => pull_with_snapshot(path, false),
            "push" => {
                let push_res = run_git_in(path, &["push"])?;
                execute_pending_remote_deletions(path);
                Ok(if push_res.is_empty() {
                    crate::tr!("Push completato con successo", "Push completed successfully")
                        .to_string()
                } else {
                    push_res
                })
            }
            "sync" => {
                // 1. Fetch
                let _ = run_git_in(path, &["fetch", "--prune"]);

                // 2. Pull che o riesce del tutto o non tocca niente
                // (R-MI-71): se non e' riuscito non si pubblica nulla.
                pull_with_snapshot(path, false)?;

                // 3. Push
                let push_res = run_git_in(path, &["push"])?;
                execute_pending_remote_deletions(path);
                Ok(crate::tr!(
                    format!("Sincronizzazione completata: {push_res}"),
                    format!("Sync completed: {push_res}")
                ))
            }
            _ => Err(crate::tr!(
                format!("Azione di sincronizzazione sconosciuta: '{action}'"),
                format!("Unknown sync action: '{action}'")
            )),
        }
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Sincronizzazione git interrotta: {e}"),
            format!("Git sync interrupted: {e}")
        )
    })?
}

pub(crate) fn execute_pending_remote_deletions(repo_dir: &Path) {
    let output = match run_git_in(
        repo_dir,
        &["config", "--local", "--get-all", "omp-studio.pendingRemoteDelete"],
    ) {
        Ok(out) => out,
        Err(_) => return,
    };
    let branches: Vec<String> = output
        .lines()
        .map(|l| l.trim_end_matches('\r').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if branches.is_empty() {
        return;
    }

    let mut remaining = Vec::new();
    for branch in branches {
        match run_git_in(repo_dir, &["push", "origin", "--delete", &branch]) {
            Ok(_) => {}
            Err(err) => {
                let err_lower = err.to_ascii_lowercase();
                if err_lower.contains("remote ref does not exist")
                    || (err_lower.contains("unable to delete") && err_lower.contains("remote ref"))
                {
                    // Branch gia' rimosso sul remote
                } else {
                    eprintln!("Warning: eliminazione remota differita fallita per '{branch}': {err}");
                    remaining.push(branch);
                }
            }
        }
    }

    let _ = run_git_in(
        repo_dir,
        &["config", "--local", "--unset-all", "omp-studio.pendingRemoteDelete"],
    );
    for branch in remaining {
        let _ = run_git_in(
            repo_dir,
            &["config", "--local", "--add", "omp-studio.pendingRemoteDelete", &branch],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);
    static SEED_FIXTURE_PATH: OnceLock<PathBuf> = OnceLock::new();

    const FIXTURE_BARE_CONFIG: &str = "\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n";

    fn append_repo_config(git_config_path: &Path, content: &str) {
        let existing = fs::read_to_string(git_config_path).unwrap_or_default();
        fs::write(git_config_path, format!("{existing}{content}"))
            .expect("impossibile scrivere la configurazione git del fixture");
    }

    fn set_writable_recursive(path: &Path) {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Ok(meta) = p.metadata() {
                    let mut perms = meta.permissions();
                    if perms.readonly() {
                        // Su Windows toglie il readonly; su Unix aggiunge solo il bit di scrittura del proprietario evitando world-writable.
                        #[cfg(windows)]
                        #[allow(clippy::permissions_set_readonly_false)]
                        perms.set_readonly(false);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let mode = perms.mode();
                            perms.set_mode(mode | 0o200);
                        }
                        let _ = fs::set_permissions(&p, perms);
                    }
                    if meta.is_dir() {
                        set_writable_recursive(&p);
                    }
                }
            }
        }
    }

    fn remove_dir_all_force(path: &Path) {
        if !path.exists() {
            return;
        }
        if fs::remove_dir_all(path).is_err() {
            set_writable_recursive(path);
            let _ = fs::remove_dir_all(path);
        }
    }

    fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let dest_path = dst.join(entry.file_name());
            if ty.is_dir() {
                copy_dir_all(&entry.path(), &dest_path)?;
            } else {
                fs::copy(entry.path(), &dest_path)?;
                if let Ok(meta) = fs::metadata(&dest_path) {
                    let mut perms = meta.permissions();
                    if perms.readonly() {
                        // Su Windows toglie il readonly; su Unix aggiunge solo il bit di scrittura del proprietario evitando world-writable.
                        #[cfg(windows)]
                        #[allow(clippy::permissions_set_readonly_false)]
                        perms.set_readonly(false);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let mode = perms.mode();
                            perms.set_mode(mode | 0o200);
                        }
                        let _ = fs::set_permissions(&dest_path, perms);
                    }
                }
            }
        }
        Ok(())
    }

    #[test]
    fn test_append_batch_mode_flag_preserves_custom_ssh() {
        assert_eq!(
            append_batch_mode_flag("ssh -i ~/.ssh/id_rsa"),
            "ssh -i ~/.ssh/id_rsa -o BatchMode=yes"
        );
        assert_eq!(
            append_batch_mode_flag("ssh -o BatchMode=yes -i ~/.ssh/id_rsa"),
            "ssh -o BatchMode=yes -i ~/.ssh/id_rsa"
        );
        assert_eq!(
            append_batch_mode_flag("plink.exe -i key.ppk"),
            "plink.exe -i key.ppk -batch"
        );
        assert_eq!(
            append_batch_mode_flag("plink.exe -batch -i key.ppk"),
            "plink.exe -batch -i key.ppk"
        );
    }

    fn run_git_test_cmd(cwd: &Path, args: &[&str]) -> std::process::Output {
        let mut command = Command::new("git");
        command.current_dir(cwd).args(args);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .output()
            .expect("git deve essere disponibile nell'ambiente di test");
        assert!(
            output.status.success(),
            "git {:?} fallito in {:?}:\nstdout: {}\nstderr: {}",
            args,
            cwd,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn run_git_test_cmd_with_stdin(cwd: &Path, args: &[&str], stdin_data: &[u8]) -> std::process::Output {
        use std::io::Write;
        let mut command = Command::new("git");
        command.current_dir(cwd).args(args);
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .expect("git deve essere disponibile nell'ambiente di test");
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(stdin_data).expect("scrittura stdin git");
        }
        let output = child
            .wait_with_output()
            .expect("attesa completamento comando git");
        assert!(
            output.status.success(),
            "git {:?} fallito in {:?}:\nstdout: {}\nstderr: {}",
            args,
            cwd,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    struct TestGitSetup {
        container: PathBuf,
        work_a: PathBuf,
        work_b: PathBuf,
    }

    impl Drop for TestGitSetup {
        fn drop(&mut self) {
            remove_dir_all_force(&self.container);
        }
    }

    fn fast_rev_parse(dir: &Path, rev: &str) -> Option<String> {
        let dot_git = dir.join(".git");
        if !dot_git.is_dir() {
            return None;
        }
        if rev == "HEAD" {
            let head_file = dot_git.join("HEAD");
            let head = fs::read_to_string(head_file).ok()?;
            let trimmed = head.trim();
            if trimmed.len() == 40 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(trimmed.to_string());
            }
            if let Some(ref_rel) = trimmed.strip_prefix("ref: ") {
                let ref_path = dot_git.join(ref_rel.trim());
                if let Ok(c) = fs::read_to_string(ref_path) {
                    let sha = c.trim();
                    if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Some(sha.to_string());
                    }
                }
            }
        } else if rev == "origin/main" || rev == "refs/remotes/origin/main" {
            let ref_path = dot_git.join("refs").join("remotes").join("origin").join("main");
            if let Ok(c) = fs::read_to_string(ref_path) {
                let sha = c.trim();
                if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Some(sha.to_string());
                }
            }
        }
        None
    }

    fn test_rev_parse(dir: &Path, rev: &str) -> String {
        fast_rev_parse(dir, rev).unwrap_or_else(|| run_git_in(dir, &["rev-parse", rev]).unwrap())
    }

    fn get_seed_fixture_path() -> &'static Path {
        SEED_FIXTURE_PATH.get_or_init(|| {
            let seed_container = std::env::temp_dir().join(format!(
                "omp-studio-sync-seed-{}",
                std::process::id()
            ));
            remove_dir_all_force(&seed_container);
            fs::create_dir_all(&seed_container).expect("creazione cartella seed git");

            // 1. Inizializza remote bare con branch iniziale main
            let remote_bare = seed_container.join("remote.git");
            fs::create_dir_all(&remote_bare).expect("creazione remote.git seed");
            run_git_test_cmd(
                &remote_bare,
                &[
                    "-c",
                    "init.defaultRefFormat=files",
                    "init",
                    "--bare",
                    "--initial-branch=main",
                    "--object-format=sha1",
                ],
            );
            append_repo_config(&remote_bare.join("config"), FIXTURE_BARE_CONFIG);

            // 2. Importa il commit iniziale con git fast-import (singolo processo batch nativo)
            const FAST_IMPORT_STREAM: &[u8] = b"commit refs/heads/main\ncommitter OMP Studio Test <test@coldiretti.invalid> 1700000000 +0000\ndata 15\ninitial commit\nM 644 inline initial.txt\ndata 3\nv1\n\n";
            run_git_test_cmd_with_stdin(&remote_bare, &["fast-import", "--quiet"], FAST_IMPORT_STREAM);

            // 3. work_a: copia indipendente del remote.git bare dentro work_a/.git
            let work_a = seed_container.join("work_a");
            let work_a_git = work_a.join(".git");
            copy_dir_all(&remote_bare, &work_a_git).expect("copia bare in work_a/.git");

            // Scrive il tracking ref refs/remotes/origin/main corrispondente
            let head_commit = fs::read_to_string(work_a_git.join("refs").join("heads").join("main"))
                .expect("lettura commit main");
            let origin_remotes = work_a_git.join("refs").join("remotes").join("origin");
            fs::create_dir_all(&origin_remotes).expect("creazione refs/remotes/origin");
            fs::write(origin_remotes.join("main"), head_commit.trim_end().to_string() + "\n")
                .expect("scrittura refs/remotes/origin/main");

            // Configurazione completa in batch per work_a: bare=false, user, maintenance, origin, branch tracking
            const WORKTREE_FULL_CONFIG: &str = "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n\tautocrlf = false\n[user]\n\tname = OMP Studio Test\n\temail = test@coldiretti.invalid\n[commit]\n\tgpgsign = false\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n[remote \"origin\"]\n\turl = ../remote.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch \"main\"]\n\tremote = origin\n\tmerge = refs/heads/main\n";
            fs::write(work_a_git.join("config"), WORKTREE_FULL_CONFIG)
                .expect("scrittura config work_a");

            // Materializza index e working tree in work_a con un singolo reset --hard HEAD
            run_git_test_cmd(&work_a, &["reset", "--hard", "HEAD"]);

            // 4. work_b: copia indipendente di work_a (zero processi Git)
            let work_b = seed_container.join("work_b");
            copy_dir_all(&work_a, &work_b).expect("copia indipendente work_b seed");

            seed_container
        }).as_path()
    }

    fn setup_test_repos() -> TestGitSetup {
        let seed = get_seed_fixture_path();
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let container = std::env::temp_dir().join(format!(
            "omp-studio-sync-test-{}-{}-{}",
            std::process::id(),
            seq,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        remove_dir_all_force(&container);
        copy_dir_all(seed, &container).expect("copia fixture seed git");

        TestGitSetup {
            work_a: container.join("work_a"),
            work_b: container.join("work_b"),
            container,
        }
    }

    #[tokio::test]
    async fn test_detect_remote_advancement_only_after_background_fetch() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // 1. Commit e push su work_a
        fs::write(setup.work_a.join("feature.txt"), "feature content\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "feat: new remote commit"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // 2. Prima del fetch, work_b non vede il commit remoto
        let status_before = git_upstream_status(path_b_str.clone()).await.unwrap();
        assert_eq!(
            status_before.behind, 0,
            "Non deve vedere commit incoming prima del fetch"
        );
        assert!(status_before.incoming_commits.is_empty());

        // 3. Esegui fetch-background
        let fetch_res = git_sync_repo(path_b_str.clone(), "fetch-background".to_string()).await;
        assert!(
            fetch_res.is_ok(),
            "fetch-background deve avere successo: {:?}",
            fetch_res
        );

        // 4. Dopo il fetch in background, work_b rileva l'avanzamento del remote
        let status_after = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(
            status_after.behind, 1,
            "Deve vedere 1 commit incoming dopo fetch-background"
        );
        assert_eq!(status_after.incoming_commits.len(), 1);
        assert_eq!(
            status_after.incoming_commits[0].subject,
            "feat: new remote commit"
        );
    }

    #[tokio::test]
    async fn test_successful_clean_ff_pull() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Commit su work_a e push su remote
        fs::write(setup.work_a.join("new_file.txt"), "clean fast forward\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "feat: pull me"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // Fetch background per aggiornare refs
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        // Esegui pull-ff con albero pulito
        let pull_res = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(
            pull_res.is_ok(),
            "pull-ff su albero pulito deve riuscire: {:?}",
            pull_res
        );

        // Verifica che il file esista e il contenuto sia corretto
        assert!(setup.work_b.join("new_file.txt").exists());
        assert_eq!(
            fs::read_to_string(setup.work_b.join("new_file.txt")).unwrap(),
            "clean fast forward\n"
        );

        // Verifica che lo stato upstream sia allineato
        let status = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(status.behind, 0);
        assert_eq!(status.ahead, 0);
    }

    #[tokio::test]
    async fn test_pull_ff_keeps_untracked_and_tracked_local_changes() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Commit su work_a e push su remote
        fs::write(setup.work_a.join("remote_file.txt"), "from remote\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "remote commit"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // Fetch background
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        // CASO 1: file non tracciato. R-MI-71: il pull non si ferma, il file
        // non viene toccato e la copia avanza.
        let untracked_path = setup.work_b.join("untracked_file.txt");
        fs::write(&untracked_path, "precious untracked data").unwrap();

        let pull = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(pull.is_ok(), "pull-ff deve riuscire: {pull:?}");
        assert!(
            untracked_path.exists(),
            "Il file non tracciato deve essere preservato"
        );
        assert_eq!(
            fs::read_to_string(&untracked_path).unwrap(),
            "precious untracked data"
        );
        assert!(setup.work_b.join("remote_file.txt").exists());

        // CASO 2: modifica non committata a file tracciato che il commit in
        // arrivo non tocca: resta dove com'era, non in stage.
        let tracked_path = setup.work_b.join("initial.txt");
        fs::write(&tracked_path, "modified locally without commit\n").unwrap();

        let pull2 = git_sync_repo(path_b_str, "pull-ff".to_string()).await;
        assert!(pull2.is_ok(), "pull-ff deve riuscire: {pull2:?}");
        assert_eq!(
            fs::read_to_string(&tracked_path).unwrap(),
            "modified locally without commit\n",
            "Il file tracciato modificato deve preservare il contenuto locale"
        );
        let status = String::from_utf8_lossy(&run_git_test_cmd(&setup.work_b, &["status", "--porcelain"]).stdout).trim().to_string();
        assert!(status.contains("M initial.txt"), "modifica locale non in stage: {status}");
        assert!(status.contains("?? untracked_file.txt"), "il file nuovo resta nuovo: {status}");
        assert!(stash_list(&setup.work_b).is_empty(), "niente nello stash");
    }

    #[tokio::test]
    async fn test_divergence_refusal_preserving_head() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // 1. Commit su work_a e push su remote (commit X)
        fs::write(setup.work_a.join("commit_x.txt"), "commit X on remote\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "commit X"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // 2. Commit divergente locale su work_b (commit Y)
        fs::write(setup.work_b.join("commit_y.txt"), "commit Y locally\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "."]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "commit Y"]);

        // Albero di lavoro in work_b è pulito (tutto committato), ma diverso da upstream
        let head_before = test_rev_parse(&setup.work_b, "HEAD");

        // 3. fetch-background rileva la divergenza
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        let status = git_upstream_status(path_b_str.clone()).await.unwrap();
        assert_eq!(status.ahead, 1, "Deve essere ahead di 1");
        assert_eq!(status.behind, 1, "Deve essere behind di 1");

        // 4. pull-ff deve rifiutare perché non è un fast-forward
        let pull_res = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(pull_res.is_err(), "pull-ff deve rifiutare rami divergenti");

        // 5. Verifica che HEAD sia preservato inalterato
        let head_after = test_rev_parse(&setup.work_b, "HEAD");
        assert_eq!(
            head_before, head_after,
            "HEAD deve essere rigorosamente preservato"
        );
        assert!(
            setup.work_b.join("commit_y.txt").exists(),
            "I commit locali devono restare intatti"
        );
    }

    #[tokio::test]
    async fn test_pull_ff_restores_head_when_a_dirty_file_would_conflict() {
        // R-MI-71 anche per «Aggiorna» (R-MI-58): il fast-forward sposta HEAD,
        // poi la riga non committata che il commit in arrivo tocca non si
        // riapplica. Il repository deve tornare esattamente com'era — HEAD
        // compreso — e l'errore deve nominare il file.
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string()).await.unwrap();
        fs::write(setup.work_b.join("initial.txt"), "modifica locale\n").unwrap();
        let head_before = test_rev_parse(&setup.work_b, "HEAD");
        let stash_before = stash_list(&setup.work_b);

        let err = git_sync_repo(path_b_str, "pull-ff".to_string())
            .await
            .expect_err("la riapplicazione in conflitto va segnalata");
        assert!(
            err.starts_with("blocked_by_local_changes:initial.txt"),
            "errore non strutturato: {err}"
        );
        assert_eq!(test_rev_parse(&setup.work_b, "HEAD"), head_before, "HEAD torna dov'era");
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "modifica locale\n"
        );
        assert_eq!(
            String::from_utf8_lossy(&run_git_test_cmd(&setup.work_b, &["status", "--porcelain"]).stdout).trim(),
            "M initial.txt",
            "modifica ancora non in stage"
        );
        assert_eq!(stash_list(&setup.work_b), stash_before, "lo stash non cambia");
        assert!(!setup.work_b.join(".git/MERGE_HEAD").exists(), "nessun merge in corso");
    }

    fn push_remote_change(setup: &TestGitSetup, file: &str, content: &str, message: &str) {
        fs::write(setup.work_a.join(file), content).unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", message]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);
    }

    fn stash_list(dir: &Path) -> String {
        String::from_utf8_lossy(
            &run_git_test_cmd(dir, &["stash", "list", "--format=%H %gs"]).stdout,
        )
        .trim()
        .to_string()
    }

    #[tokio::test]
    async fn test_pull_with_only_untracked_keeps_preexisting_stash() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Stash preesistente dell'utente su work_b
        fs::write(setup.work_b.join("initial.txt"), "lavoro parcheggiato\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["stash", "push", "-m", "stash utente"]);
        let stash_before = stash_list(&setup.work_b);
        assert!(stash_before.contains("stash utente"));

        push_remote_change(&setup, "remote.txt", "dal remoto\n", "remote commit");

        // Solo un file non tracciato: il vecchio stash manuale non creava nulla e
        // il pop applicava lo stash dell'utente.
        let untracked = setup.work_b.join("bozza.txt");
        fs::write(&untracked, "non tracciato\n").unwrap();

        let res = git_sync_repo(path_b_str, "pull".to_string()).await;
        assert!(res.is_ok(), "pull deve riuscire: {res:?}");

        assert_eq!(
            stash_list(&setup.work_b),
            stash_before,
            "lo stash utente deve restare intatto"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "v1\n",
            "lo stash utente non deve essere applicato"
        );
        assert_eq!(fs::read_to_string(&untracked).unwrap(), "non tracciato\n");
        assert!(setup.work_b.join("remote.txt").exists());
    }

    #[tokio::test]
    async fn test_pull_preserves_tracked_changes() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "remote.txt", "dal remoto\n", "remote commit");

        // Commit locale divergente + modifica tracciata non committata su un altro file
        fs::write(setup.work_b.join("local.txt"), "commit locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "."]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "local commit"]);
        fs::write(setup.work_b.join("initial.txt"), "v1 modificato\n").unwrap();

        let res = git_sync_repo(path_b_str.clone(), "pull".to_string()).await;
        assert!(res.is_ok(), "pull deve riuscire: {res:?}");

        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "v1 modificato\n"
        );
        assert!(setup.work_b.join("remote.txt").exists());
        assert!(setup.work_b.join("local.txt").exists());
        assert!(
            stash_list(&setup.work_b).is_empty(),
            "nessuno stash: le modifiche passano dall'istantanea (R-MI-71)"
        );
        let status = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(status.behind, 0);
        assert_eq!(status.ahead, 1);
    }

    #[tokio::test]
    async fn test_pull_conflict_aborts_rebase_and_restores_tree() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");

        // Commit locale in conflitto con il remoto + modifica non committata
        fs::write(setup.work_b.join("initial.txt"), "versione locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["commit", "-am", "local edit"]);
        fs::write(setup.work_b.join("other.txt"), "tracciato\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "other.txt"]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "other"]);
        fs::write(setup.work_b.join("other.txt"), "modifica in corso\n").unwrap();
        fs::write(setup.work_b.join("untracked.txt"), "nuovo\n").unwrap();
        let head_before = test_rev_parse(&setup.work_b, "HEAD");

        let res = git_sync_repo(path_b_str.clone(), "pull".to_string()).await;
        let err = res.expect_err("il pull in conflitto deve fallire");
        // R-MI-71: l'errore nomina il file che blocca, e il repository resta
        // esattamente com'era (niente rebase a meta', niente marcatori).
        assert!(err.contains("initial.txt"), "messaggio inatteso: {err}");
        assert!(!err.contains("<<<<<<<"), "nessun marcatore nel messaggio: {err}");

        assert!(
            !rebase_in_progress(&setup.work_b),
            "nessun rebase deve restare in corso"
        );
        assert_eq!(
            test_rev_parse(&setup.work_b, "HEAD"),
            head_before
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "versione locale\n"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("other.txt")).unwrap(),
            "modifica in corso\n"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("untracked.txt")).unwrap(),
            "nuovo\n"
        );
        assert!(stash_list(&setup.work_b).is_empty());

        // sync non deve pubblicare nulla se il pull fallisce
        let remote_head = test_rev_parse(&setup.work_a, "HEAD");
        let sync = git_sync_repo(path_b_str, "sync".to_string()).await;
        assert!(sync.is_err());
        let remote_after = test_rev_parse(&setup.work_b, "origin/main");
        assert_eq!(
            remote_after, remote_head,
            "sync non deve fare push dopo un pull fallito"
        );
    }

    #[tokio::test]
    async fn test_pull_does_not_abort_user_rebase() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Rebase dell'utente fermo su un conflitto
        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");
        fs::write(setup.work_b.join("initial.txt"), "versione locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["commit", "-am", "local edit"]);
        run_git_test_cmd(&setup.work_b, &["fetch"]);
        let rebase = Command::new("git")
            .current_dir(&setup.work_b)
            .args(["rebase", "origin/main"])
            .output()
            .unwrap();
        assert!(
            !rebase.status.success(),
            "il rebase deve fermarsi sul conflitto"
        );
        assert!(rebase_in_progress(&setup.work_b));

        let err = git_sync_repo(path_b_str, "pull".to_string())
            .await
            .expect_err("il pull deve rifiutarsi");
        assert!(err.contains("rebase in corso") || err.contains("rebase is already in progress"), "{err}");
        assert!(
            rebase_in_progress(&setup.work_b),
            "il rebase dell'utente non va annullato"
        );
    }

    #[tokio::test]
    async fn test_pull_with_dirty_journal_leaves_nothing_in_the_stash() {
        // R-MI-59 e R-MI-72: la riga di diario non committata e quella
        // arrivata da origin stanno nello stesso file; senza l'attributo di
        // unione la riapplicazione confliggerebbe, con l'attributo restano
        // entrambe nel working tree e lo stash resta vuoto.
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();
        // La regola nasce in `<git-common-dir>/info/attributes` come per il
        // diario vero: `ensure_journal_union` la scrive alla prima operazione.
        let journal = "CHANGELOG.md";
        fs::write(setup.work_a.join(journal), "# Changelog\n\n## [Unreleased]\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "changelog base"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string()).await.unwrap();
        run_git_test_cmd(&setup.work_b, &["pull", "--ff-only"]);

        // Una voce per parte, nello stesso punto del file (R-MI-72).
        fs::write(setup.work_a.join(journal), "# Changelog\n\n## [Unreleased]\n- dal mac\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["commit", "-am", "voce dal mac"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);
        fs::write(setup.work_b.join(journal), "# Changelog\n\n## [Unreleased]\n- da qui\n").unwrap();
        let stash_before = stash_list(&setup.work_b);

        let res = git_sync_repo(path_b_str, "pull".to_string()).await;
        assert!(res.is_ok(), "la pull deve riuscire: {res:?}");
        let content = fs::read_to_string(setup.work_b.join(journal)).unwrap();
        assert!(content.contains("- dal mac"), "{content}");
        assert!(content.contains("- da qui"), "{content}");
        assert!(!content.contains("<<<<<<<"), "{content}");
        assert_eq!(stash_list(&setup.work_b), stash_before, "niente nello stash");
        assert_eq!(
            String::from_utf8_lossy(&run_git_test_cmd(&setup.work_b, &["status", "--porcelain"]).stdout).trim(),
            format!("M {journal}"),
            "la riga locale resta non committata"
        );
    }

    #[tokio::test]
    async fn a_local_line_and_an_incoming_line_leave_the_repository_exactly_as_it_was() {
        // R-MI-71, accettazione: riga non committata e commit in arrivo sulla
        // stessa riga. Il pull non lascia marcatori, non lascia voci nello
        // stash, e il repository resta esattamente com'era; l'errore e'
        // strutturato e nomina il file.
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");
        fs::write(setup.work_b.join("initial.txt"), "modifica locale\n").unwrap();
        let head_before = test_rev_parse(&setup.work_b, "HEAD");
        let stash_before = stash_list(&setup.work_b);

        let err = git_sync_repo(path_b_str, "pull".to_string())
            .await
            .expect_err("la riapplicazione in conflitto va segnalata");
        assert!(
            err.starts_with("blocked_by_local_changes:initial.txt"),
            "errore non strutturato: {err}"
        );
        // Repository identico a prima: HEAD, file e indice.
        assert_eq!(test_rev_parse(&setup.work_b, "HEAD"), head_before);
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "modifica locale\n"
        );
        assert_eq!(
            String::from_utf8_lossy(&run_git_test_cmd(&setup.work_b, &["status", "--porcelain"]).stdout).trim(),
            "M initial.txt"
        );
        // Niente stash, niente marcatori, niente operazione a meta'.
        assert_eq!(stash_list(&setup.work_b), stash_before, "lo stash non cambia");
        assert!(!rebase_in_progress(&setup.work_b));
        assert!(!setup.work_b.join(".git/MERGE_HEAD").exists(), "nessun merge in corso");
    }

    #[tokio::test]
    async fn test_fixture_seed_independent_copies_isolation() {
        let setup1 = setup_test_repos();
        let setup2 = setup_test_repos();

        assert_ne!(setup1.container, setup2.container);
        assert_ne!(setup1.work_a, setup2.work_a);
        assert_ne!(setup1.work_b, setup2.work_b);

        fs::write(setup1.work_a.join("mutated_a.txt"), "mutazione a\n").unwrap();
        run_git_test_cmd(&setup1.work_a, &["add", "."]);
        run_git_test_cmd(&setup1.work_a, &["commit", "-m", "mutation on setup1 work_a"]);
        fs::write(setup1.work_b.join("mutated_b.txt"), "mutazione b\n").unwrap();

        assert!(!setup2.work_a.join("mutated_a.txt").exists());
        assert!(!setup2.work_b.join("mutated_b.txt").exists());
        assert!(!setup1.work_a.join("mutated_b.txt").exists());
        assert!(!setup1.work_b.join("mutated_a.txt").exists());

        let status2_a = run_git_test_cmd(&setup2.work_a, &["status", "--porcelain"]);
        assert!(status2_a.stdout.is_empty());
        let status2_b = run_git_test_cmd(&setup2.work_b, &["status", "--porcelain"]);
        assert!(status2_b.stdout.is_empty());
    }

    #[tokio::test]
    async fn test_pull_ff_fails_closed_on_non_git_dir() {
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp =
            std::env::temp_dir().join(format!("omp-not-a-git-repo-{}-{}", std::process::id(), seq));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();

        let res = git_sync_repo(temp.to_str().unwrap().to_string(), "pull-ff".to_string()).await;
        let _ = fs::remove_dir_all(&temp);

        assert!(
            res.is_err(),
            "pull-ff su cartella non git deve fallire chiuso"
        );
    }

    #[test]
    fn test_parse_porcelain_v2_upstream_ahead_behind() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head feature/login
# branch.upstream origin/feature/login
# branch.ab +3 -2
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "feature/login");
        assert_eq!(info.upstream, Some("origin/feature/login".to_string()));
        assert_eq!(info.ahead, 3);
        assert_eq!(info.behind, 2);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_detached_head() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head (detached)
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "(detached)");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_no_upstream() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "main");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_initial_unborn_branch() {
        let raw = "\
# branch.oid (initial)
# branch.head main
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "main");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_dirty_vs_clean() {
        let raw_clean = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
";
        let info_clean = parse_porcelain_v2_branch(raw_clean);
        assert!(!info_clean.has_uncommitted);

        let raw_dirty = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
1 .M N... 100644 100644 100644 123 456 src/main.rs
? untracked.txt
";
        let info_dirty = parse_porcelain_v2_branch(raw_dirty);
        assert!(info_dirty.has_uncommitted);
        assert_eq!(info_dirty.changed_files, 2);
        assert_eq!(info_dirty.head_commit.as_deref(), Some("881a25b3e1fa841ed15c654789cc993158a08c45"));
        assert_eq!(parse_porcelain_v2_branch("# branch.oid (initial)\n# branch.head main\n").head_commit, None);
    }

    #[test]
    fn test_parse_porcelain_v2_fallback_head() {
        let raw = "";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "HEAD");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[tokio::test]
    async fn test_shallow_repo_has_no_root_commit_identity() {
        let setup = setup_test_repos();
        // Trasforma work_b in un clone shallow del remote, cosi' la radice vera
        // non e' presente (M3): `--is-shallow-repository` e' true e il primo
        // commit non deve essere usato come identita'.
        let shallow = setup.container.join("work_shallow");
        // `file://` evita l'ottimizzazione del clone locale, che ignora
        // `--depth` e non produrrebbe un repository shallow.
        let source = format!("file://{}", setup.work_b.join(".git").to_str().unwrap());
        run_git_test_cmd(&setup.container, &[
            "clone", "--quiet", "--depth", "1", &source, shallow.to_str().unwrap(),
        ]);
        let shallow_str = shallow.to_str().unwrap().to_string();
        let status = git_upstream_status(shallow_str).await.unwrap();
        assert!(status.is_git);
        assert_eq!(
            run_git_in(&shallow, &["rev-parse", "--is-shallow-repository"]).unwrap(),
            "true"
        );
        assert_eq!(status.root_commit, None, "un clone shallow non deve esporre la radice come identita'");
    }
}
