# Isolated concept-room import (operator runbook)

No source snapshot, private comment, media file, OAuth token, or receipt is committed. This branch **implements** migration only; no import or cloud mutation was performed here. Target is hard-allowlisted as `sinai-concept-room-dd26`, Firestore `(default)`, bucket `sinai-concept-room-dd26.firebasestorage.app`.

Run from the repository root with Node 24+ on the authorized Windows operator machine. These paths refer to the approved private backup under `C:/Users/dtami/AppData/Local/hermes/data`; flags `--source`, `--inventory`, `--verification`, `--manifest`, `--extras`, `--mediaRoot` override them, but the five metadata files must retain their pinned SHA-256 bytes. Do not put receipts/reports in the repository or publish them. Firebase CLI must already be logged in (`firebase login`); the script loads its `lib/auth.js` in-process from the local CLI installation, obtains an OAuth token in memory, and does not use service account key files. Override the location with `--firebase-tools-lib <absolute-path-to-firebase-tools/lib>` if the npx cache differs. Neither the CLI login nor project creation is attempted by these scripts.

```bash
# Local only: re-hash every backed-up media file, validate source/FKs/embedded reviews/notes/counts.
node tools/firebase-import.mjs
# Local-only tests (no --apply, no network):
node --test tests/firebase-import.test.mjs
# Operator only, after independent review and project/budget/rules checks; creates remote state:
node tools/firebase-import.mjs --apply --project sinai-concept-room-dd26 --receipts 'C:/Users/dtami/AppData/Local/hermes/data/concept-firebase-20260923/firebase-import-receipts.json'
# Independent read-only remote attestation; downloads all media and compares SHA-256:
node tools/firebase-verify.mjs --project sinai-concept-room-dd26 --report 'C:/Users/dtami/AppData/Local/hermes/data/concept-firebase-20260923/firebase-import-report.json'
```

**Operator gate:** use the exact `--apply --project` pair; dry-run never loads OAuth. Do not deploy/cut over until `firebase-verify.mjs` exits 0 and the private report has `status: "verified"`, `documents: 249`, `media: 135`, `bytes: 104901305`. If it exits nonzero, the report is durable with `status: "failed"` and bounded progress. It is deliberately not a user-content log.

Import order: create-only GCS objects first (`ifGenerationMatch=0`), then Firestore commit writes (`currentDocument.exists=false`). Every item is read back and compared byte-for-byte (GCS streamed SHA-256) or by canonical exact values (Firestore); pre-existing exact values are accepted, any discrepancy aborts. Transport errors and concurrent create conflicts are reconciled by a fresh GET before retry; no overwrite path exists. Receipts are atomically replaced and fsynced after *each* successful item, with a pinned plan digest. Restart with the same receipt path after interruption; every item, including one with an existing receipt, is re-read. No automatic rollback: a failed run may leave a verified prefix, safe to rerun only after diagnosing the cause. Avoid concurrent operators and keep the receipt file private; use a new path for an unrelated migration. Firestore strings preserve original ISO timestamp spelling/precision rather than converting to Firestore timestamp values; integers remain integer values, nulls/booleans remain typed. The full source row is embedded with all source reviews sorted by `(created_at,id)` and assessment or null, plus immutable top-level collections.

Verifier lists *all* bucket objects and each target collection with pagination and rejects extras/missing entries. It separately GETs each expected document and streams every object to SHA-256; only counts/digests appear in its report/stdout, not titles, comments, paths, tokens, or row data. Neither script checks the project's billing cap, rules, Auth, or app deployment; parent operator must independently confirm those. Verification is a point-in-time read pass, not a transactional multi-service snapshot; freeze writers during run and repeat if writes overlap. OAuth CLI cache path may move; override as above and confirm login/scopes before apply. If inputs change, **stop**; review/re-pin the five hashes through a new code review instead of bypassing checks.
