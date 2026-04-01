# Version Management

This guide covers how the OWASP Top 10 cache and update system works in the top10-scan plugin.

## Overview

The plugin maintains a local cache of OWASP Top 10 data that drives category mappings, review prompts, and CWE-to-category lookups. This cache can be updated independently of the plugin version, allowing the scan to stay current with OWASP changes without requiring a plugin release.

## Cache Structure

The cache lives in the plugin's data directory and consists of three files:

### top10.json

The core OWASP Top 10 data file. Contains:

- **categories**: The ten OWASP categories with IDs, names, and descriptions (e.g., A01 - Broken Access Control).
- **cwe_mapping**: A lookup table mapping CWE IDs to their corresponding OWASP category. This is the primary mechanism for classifying scan findings.
- **version**: The OWASP Top 10 version this data represents (e.g., "2021").

```json
{
  "version": "2021",
  "categories": [
    {
      "id": "A01",
      "name": "Broken Access Control",
      "description": "...",
      "cwes": [22, 23, 35, 59, 200, 201, 219, 264, 275, 276, 284, 285, 352, 359, 377, 402, 425, 441, 497, 538, 540, 548, 552, 566, 601, 639, 651, 668, 706, 862, 863, 913, 922, 1275]
    }
  ],
  "cwe_mapping": {
    "22": "A01",
    "79": "A03",
    "89": "A03",
    "287": "A07",
    "327": "A02",
    "502": "A08",
    "918": "A10"
  }
}
```

### review-prompts.json

Framework-specific review guidance used by the design review pass. Contains:

- **framework_hints**: Per-framework auth patterns, common misconfigurations, and security middleware to check for.
- **category_prompts**: Per-OWASP-category review questions that guide the LLM-based design review.

This file is updated alongside top10.json to keep review guidance aligned with the current OWASP version.

### state.json

Tracks cache metadata:

- **last_updated**: ISO 8601 timestamp of the most recent cache update.
- **owasp_version**: The OWASP Top 10 version currently cached.
- **update_source**: Where the data was fetched from (e.g., "owasp-api", "manual", "bundled").
- **checksum**: SHA-256 hash of top10.json for integrity verification.

```json
{
  "last_updated": "2025-11-15T10:30:00Z",
  "owasp_version": "2021",
  "update_source": "owasp-api",
  "checksum": "a1b2c3d4..."
}
```

## Update Flow

### Automatic Updates via update-owasp.py

The `update-owasp.py` script fetches the latest OWASP Top 10 data and rebuilds the cache.

```bash
python update-owasp.py
```

The update process:

1. **Fetch**: Downloads the current OWASP Top 10 category definitions and CWE mappings from the OWASP data repository.
2. **Parse**: Extracts category IDs, names, descriptions, and associated CWE lists.
3. **Build cwe_mapping**: Inverts the per-category CWE lists into a flat CWE-to-category lookup table.
4. **Write top10.json**: Saves the structured data.
5. **Update review-prompts.json**: Regenerates category-specific review prompts based on the new category definitions. Framework hints are preserved.
6. **Update state.json**: Records the update timestamp, version, source, and checksum.

### Update Triggers

The plugin checks the cache age at scan start. If the cache is older than 90 days, it prints a warning recommending an update. The scan still proceeds with stale data -- it never blocks on an update.

### Manual Updates

To manually update the cache without fetching from the network:

1. Edit `top10.json` directly with the new category data and CWE mappings.
2. Update `state.json` to reflect the change:

```bash
python update-owasp.py --source manual
```

This recalculates the checksum and updates the timestamp without fetching remote data.

Alternatively, replace `top10.json` with a file from another source and run:

```bash
python update-owasp.py --rebuild-state
```

This regenerates `state.json` from the current `top10.json` contents.

## Version Migration

When OWASP releases a new Top 10 version (e.g., moving from 2021 to a future 2025 edition), the migration is handled primarily through CWE-based mapping.

### Why CWE-Based Mapping Enables Automatic Migration

OWASP categories change between versions -- categories are renamed, merged, split, or reordered. However, CWE IDs are stable identifiers maintained independently by MITRE.

Because the scan engine maps findings to OWASP categories through CWE IDs (not through hardcoded category names), updating the cache with new OWASP data automatically re-maps all findings to the new categories.

### Migration Process

1. Run `update-owasp.py` to fetch the new version data.
2. The new `top10.json` contains updated category definitions and a rebuilt CWE mapping.
3. Existing Opengrep rules with CWE metadata are automatically mapped to the new categories -- no rule changes needed.
4. Rules using explicit `owasp` metadata (without CWE) may need manual updates if category IDs changed.
5. Review `state.json` to confirm the new version is active.

### Handling Unmapped CWEs

If the new OWASP version drops a CWE from all categories, findings with that CWE appear in the "unmapped" section of scan results. Review these periodically and either:

- Add the CWE to the appropriate category in top10.json (if the OWASP mapping is incomplete).
- Add an explicit `owasp` field to the rule metadata as an override.
- Accept the finding as informational (outside OWASP Top 10 scope but still worth reporting).

### Backward Compatibility

The plugin stores the OWASP version in `state.json`. Scan results include the OWASP version used, so results from different versions can be compared with context. No scan results are invalidated by a version update -- they simply reflect the mapping that was active at scan time.
