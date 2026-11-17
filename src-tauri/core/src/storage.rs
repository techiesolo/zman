//! The app's documents, one JSON file each, under a single data directory:
//!
//! ```text
//! <root>/collections/<id>.json
//! <root>/environments/<id>.json
//! <root>/<id>.json              (globals, history, state)
//! ```
//!
//! Callers name a document by kind and id, never by path, so nothing outside
//! the data directory can be reached through this module.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_ID_LEN: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Collections,
    Environments,
    /// Single documents that sit directly in the data directory.
    App,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("unknown document kind: {0:?}")]
    UnknownKind(String),
    #[error("invalid document id: {0:?}")]
    InvalidId(String),
    #[error("{action} {path}: {source}")]
    Io {
        action: &'static str,
        path: String,
        #[source]
        source: io::Error,
    },
}

impl std::str::FromStr for Kind {
    type Err = StoreError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        match text {
            "collections" => Ok(Self::Collections),
            "environments" => Ok(Self::Environments),
            "app" => Ok(Self::App),
            other => Err(StoreError::UnknownKind(other.to_owned())),
        }
    }
}

/// Ids become file names, so only characters that cannot form a path are
/// accepted.
fn check_id(id: &str) -> Result<(), StoreError> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if valid {
        Ok(())
    } else {
        Err(StoreError::InvalidId(id.to_owned()))
    }
}

fn io_error<'a>(action: &'static str, path: &'a Path) -> impl FnOnce(io::Error) -> StoreError + 'a {
    move |source| StoreError::Io {
        action,
        path: path.display().to_string(),
        source,
    }
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn dir(&self, kind: Kind) -> PathBuf {
        match kind {
            Kind::Collections => self.root.join("collections"),
            Kind::Environments => self.root.join("environments"),
            Kind::App => self.root.clone(),
        }
    }

    fn path(&self, kind: Kind, id: &str) -> Result<PathBuf, StoreError> {
        check_id(id)?;
        Ok(self.dir(kind).join(format!("{id}.json")))
    }

    /// Ids of the stored documents of this kind, sorted.
    pub fn list(&self, kind: Kind) -> Result<Vec<String>, StoreError> {
        let dir = self.dir(kind);
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(io_error("could not list", &dir)(e)),
        };
        let mut ids = Vec::new();
        for entry in entries {
            let entry = entry.map_err(io_error("could not list", &dir))?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            // Skips temporary files and anything a person dropped in by hand
            // under a name the app could not address.
            if check_id(id).is_ok() {
                ids.push(id.to_owned());
            }
        }
        ids.sort();
        Ok(ids)
    }

    /// `None` when the document does not exist.
    pub fn read(&self, kind: Kind, id: &str) -> Result<Option<String>, StoreError> {
        let path = self.path(kind, id)?;
        match fs::read_to_string(&path) {
            Ok(contents) => Ok(Some(contents)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io_error("could not read", &path)(e)),
        }
    }

    /// Replaces the document in one step: readers see either the old file or
    /// the new one, and a crash mid-write leaves the old one in place.
    pub fn write(&self, kind: Kind, id: &str, contents: &str) -> Result<(), StoreError> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let path = self.path(kind, id)?;
        let dir = self.dir(kind);
        fs::create_dir_all(&dir).map_err(io_error("could not create", &dir))?;

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = dir.join(format!(".{id}.json.{}.{unique}.tmp", std::process::id()));
        let written = (|| {
            let mut file = fs::File::create(&temp)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temp, &path)
        })();
        if let Err(e) = written {
            let _ = fs::remove_file(&temp);
            return Err(io_error("could not write", &path)(e));
        }
        Ok(())
    }

    /// Deleting a document that does not exist is not an error.
    pub fn delete(&self, kind: Kind, id: &str) -> Result<(), StoreError> {
        let path = self.path(kind, id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_error("could not delete", &path)(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        (dir, store)
    }

    #[test]
    fn writes_reads_lists_and_deletes() {
        let (dir, store) = store();
        assert_eq!(store.list(Kind::Collections).unwrap(), Vec::<String>::new());
        assert_eq!(store.read(Kind::Collections, "a").unwrap(), None);

        store.write(Kind::Collections, "b", "{\"n\":2}").unwrap();
        store.write(Kind::Collections, "a", "{\"n\":1}").unwrap();
        store.write(Kind::App, "state", "{}").unwrap();

        assert_eq!(store.list(Kind::Collections).unwrap(), vec!["a", "b"]);
        assert_eq!(store.list(Kind::App).unwrap(), vec!["state"]);
        assert_eq!(
            store.read(Kind::Collections, "a").unwrap().as_deref(),
            Some("{\"n\":1}")
        );
        assert!(dir.path().join("collections/a.json").is_file());
        assert!(dir.path().join("state.json").is_file());

        store.delete(Kind::Collections, "a").unwrap();
        store.delete(Kind::Collections, "a").unwrap();
        assert_eq!(store.list(Kind::Collections).unwrap(), vec!["b"]);
    }

    #[test]
    fn overwrite_replaces_contents_and_leaves_no_temp_files() {
        let (dir, store) = store();
        store
            .write(Kind::Environments, "e", "old and long")
            .unwrap();
        store.write(Kind::Environments, "e", "new").unwrap();
        assert_eq!(
            store.read(Kind::Environments, "e").unwrap().as_deref(),
            Some("new")
        );

        let names: Vec<_> = fs::read_dir(dir.path().join("environments"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["e.json"]);
    }

    #[test]
    fn rejects_ids_that_could_leave_the_data_directory() {
        let (dir, store) = store();
        let outside = dir.path().parent().unwrap().join("escaped.json");
        for id in [
            "../escaped",
            "..",
            "a/b",
            "a\\b",
            "",
            ".hidden",
            "a.b",
            "/etc/passwd",
            "a\0b",
        ] {
            assert!(
                matches!(
                    store.write(Kind::Collections, id, "x"),
                    Err(StoreError::InvalidId(_))
                ),
                "{id:?}"
            );
            assert!(
                matches!(
                    store.read(Kind::Collections, id),
                    Err(StoreError::InvalidId(_))
                ),
                "{id:?}"
            );
            assert!(
                matches!(store.delete(Kind::App, id), Err(StoreError::InvalidId(_))),
                "{id:?}"
            );
        }
        assert!(matches!(
            store.write(Kind::App, &"a".repeat(129), "x"),
            Err(StoreError::InvalidId(_))
        ));
        assert!(!outside.exists());
    }

    #[test]
    fn list_ignores_files_the_app_did_not_write() {
        let (dir, store) = store();
        store.write(Kind::Collections, "real", "{}").unwrap();
        let collections = dir.path().join("collections");
        fs::write(collections.join("notes.txt"), "x").unwrap();
        fs::write(collections.join(".real.json.1.2.tmp"), "x").unwrap();
        fs::write(collections.join("has space.json"), "x").unwrap();
        assert_eq!(store.list(Kind::Collections).unwrap(), vec!["real"]);
    }

    #[test]
    fn parses_kinds() {
        assert_eq!("collections".parse::<Kind>().unwrap(), Kind::Collections);
        assert_eq!("app".parse::<Kind>().unwrap(), Kind::App);
        assert!(matches!(
            "../x".parse::<Kind>(),
            Err(StoreError::UnknownKind(_))
        ));
    }
}
