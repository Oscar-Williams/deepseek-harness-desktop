use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const PERMISSION_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js";
const DERIVE_ORIGINAL: &str = r#"state.status = "ready";
						state.error = null;
						state.writable = writable;
						state.currentValue = resolved.currentValue;"#;
const DERIVE_PATCHED: &str = r#"state.status = state.error === null ? "ready" : "error";
						state.writable = writable;
						state.currentValue = resolved.currentValue;"#;

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(DERIVE_PATCHED) {
        return PatchOutcome::AlreadyPatched;
    }
    if source.matches(DERIVE_ORIGINAL).count() != 1 {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(DERIVE_ORIGINAL, DERIVE_PATCHED, 1))
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, PERMISSION_CLIENT_JS, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, PERMISSION_CLIENT_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_CONTROLLER: &str =
        include_str!("../../../../test/fixtures/permission-settings-rc2.txt");

    #[test]
    fn patches_real_controller_once() {
        let PatchOutcome::Patched(patched) = patch_source(LEGACY_CONTROLLER) else {
            panic!("expected Patched");
        };
        assert!(patched.contains(DERIVE_PATCHED));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn leaves_changed_or_ambiguous_anchors_unchanged() {
        assert_eq!(patch_source(""), PatchOutcome::AnchorMissing);
        assert_eq!(
            patch_source(&DERIVE_ORIGINAL.repeat(2)),
            PatchOutcome::AnchorMissing
        );
    }
}
