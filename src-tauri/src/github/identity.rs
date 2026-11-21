//! Identita' delle copie di un repository rinominato su GitHub (R-MI-32).
//!
//! Dopo una rinomina una copia puo' avere ancora l'`origin` col nome vecchio:
//! GitHub reindirizza, quindi git funziona, ma le due copie hanno slug diversi
//! e Studio le mostrava come due progetti. Qui si chiede a GitHub il nome
//! attuale di uno slug e si aggiorna l'indirizzo della copia rimasta indietro.

use std::time::Duration;

use super::auth::get_saved_token;

/// `owner/repo` con i soli caratteri ammessi da GitHub: lo slug arriva da un
/// indirizzo git e finisce in un URL dell'API.
fn valid_slug(slug: &str) -> bool {
    let mut parts = slug.split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    // `.` e `..` cambierebbero il percorso dell'URL dell'API.
    let ok = |part: &str| !part.is_empty() && part.len() <= 100 && part != "." && part != ".."
        && part.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    ok(owner) && ok(repo)
}

/// Nome attuale (`owner/repo`, minuscolo) di un repository GitHub, seguendo
/// il reindirizzamento di una rinomina. `None` senza rete, senza credenziali
/// per un repository privato o se il repository non esiste: in quei casi le
/// copie semplicemente non si uniscono per rinomina, senza errori a vista.
#[tauri::command]
pub async fn github_canonical_repo(slug: String) -> Result<Option<String>, String> {
    if !valid_slug(&slug) { return Ok(None); }
    let Ok(client) = reqwest::Client::builder()
        .user_agent("OMP-Studio")
        .timeout(Duration::from_secs(10))
        .build() else { return Ok(None) };
    let mut request = client.get(format!("https://api.github.com/repos/{slug}"));
    if let Some(token) = get_saved_token() { request = request.bearer_auth(token); }
    let Ok(response) = request.send().await else { return Ok(None) };
    if !response.status().is_success() { return Ok(None); }
    let Ok(body) = response.json::<serde_json::Value>().await else { return Ok(None) };
    Ok(body.get("full_name").and_then(|name| name.as_str()).map(str::to_lowercase).filter(|name| valid_slug(name)))
}

/// Indirizzo `origin` con il nuovo `owner/repo`, nello stesso formato di
/// quello attuale (https, ssh `git@github.com:` o `ssh://`), `.git` compreso.
fn rewrite_github_url(url: &str, slug: &str) -> Option<String> {
    let trimmed = url.trim();
    let (prefix, rest) = ["https://github.com/", "http://github.com/", "git@github.com:", "ssh://git@github.com/"]
        .iter()
        .find_map(|prefix| trimmed.strip_prefix(prefix).map(|rest| (*prefix, rest)))?;
    let suffix = if rest.ends_with(".git") { ".git" } else { "" };
    Some(format!("{prefix}{slug}{suffix}"))
}

/// Aggiorna l'`origin` di questa copia al nome attuale del repository
/// (R-MI-32). Solo indirizzi GitHub: gli altri restano come sono.
#[tauri::command]
pub async fn github_update_origin(project_path: String, slug: String) -> Result<(), String> {
    if !valid_slug(&slug) { return Err("Invalid repository name".into()); }
    tokio::task::spawn_blocking(move || {
        let dir = std::path::Path::new(&project_path);
        let current = super::sync::run_git_in(dir, &["remote", "get-url", "origin"])?;
        let updated = rewrite_github_url(&current, &slug).ok_or_else(|| crate::tr!(
            "L'indirizzo origin non è di GitHub: lo lascio com'è",
            "The origin address is not a GitHub one: leaving it as it is"
        ).to_string())?;
        super::sync::run_git_in(dir, &["remote", "set-url", "origin", &updated]).map(|_| ())
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_new_name_keeps_the_address_format() {
        assert_eq!(rewrite_github_url("https://github.com/me/old.git", "me/new").as_deref(), Some("https://github.com/me/new.git"));
        assert_eq!(rewrite_github_url("git@github.com:me/old.git", "me/new").as_deref(), Some("git@github.com:me/new.git"));
        assert_eq!(rewrite_github_url("ssh://git@github.com/me/old", "me/new").as_deref(), Some("ssh://git@github.com/me/new"));
        assert_eq!(rewrite_github_url("https://gitlab.com/me/old.git", "me/new"), None);
    }

    #[test]
    fn slugs_from_another_machine_cannot_reach_other_api_paths() {
        assert!(valid_slug("maurizio/omp-studio"));
        for bad in ["me", "me/repo/extra", "../x", "me/..", "me/re po", "me/r?x", ""] {
            assert!(!valid_slug(bad), "{bad}");
        }
    }
}
