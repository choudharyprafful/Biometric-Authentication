"""
Runs the team's AI/ML security proof-of-concepts and records what they show,
for the "AI Security" page in the SecureAI web app.

    python ai_security_report.py           write the report the API serves
    python ai_security_report.py --check   exit 1 if that report is stale (CI)

Both PoCs are imported and run UNMODIFIED, through their own functions:
    model_starter.py               Yaseen    consent gate, per-user cap (anti-poisoning),
                                             canary extraction, deduplication, deletion
    memorisation_leakage_model.py  Sadhakshi memorisation/leakage defence

The report records each script's SHA-256, so any edit to a PoC makes the
committed report stale until it is regenerated; CI runs --check.
Synthetic data only, as in the PoCs themselves.
"""

import contextlib
import hashlib
import io
import json
import pathlib
import sys

sys.dont_write_bytecode = True

import memorisation_leakage_model as mlm  # noqa: E402
import model_starter as ms  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
REPORT = HERE.parent / "api-server" / "src" / "lib" / "aiPocReport.json"

# The prompt variations both teammates' Week 7-8 extraction-resistance blocks use ([4B] in model_starter.py).
EXTRACTION_PROMPTS = ["my private", "private reference", "reference is"]


def sha256(name):
    return hashlib.sha256((HERE / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def console_of(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn()
    return buf.getvalue()


def starter_kit():
    records = ms.generate_corpus()
    with contextlib.redirect_stdout(io.StringIO()):  # consent_gate prints each block; the console capture below keeps that
        allowed, blocked = ms.consent_gate(records)
    vulnerable = ms.train(allowed, dedup=False)
    hardened = ms.train(allowed, dedup=True)
    remaining = ms.delete_user(allowed, "user-00")
    retrained = ms.train(remaining, dedup=True)
    return {
        "script": "model_starter.py",
        "author": "Yaseen",
        "sha256": sha256("model_starter.py"),
        "corpus": {
            "records": len(records),
            "canaryCopies": sum(ms.CANARY in r["text"] for r in records),
            "traceabilityFields": ["user_id", "consent_id", "source_id"],
        },
        "consentGate": {
            "allowed": len(allowed),
            "blocked": [{"userId": r["user_id"], "sourceId": r["source_id"], "reason": why} for r, why in blocked],
            "perUserCap": ms.MAX_DOCS_PER_USER,
        },
        "vulnerable": {
            "docs": vulnerable["docs"],
            "prompt": ms.EXTRACTION_PROMPT,
            "output": ms.generate(vulnerable, ms.EXTRACTION_PROMPT, 16),
            "canaryLeaked": ms.extraction_test(vulnerable, ms.EXTRACTION_PROMPT, ms.CANARY),
        },
        "hardened": {
            "duplicatesRemoved": hardened["duplicates_removed"],
            "prompt": ms.EXTRACTION_PROMPT,
            "output": ms.generate(hardened, ms.EXTRACTION_PROMPT, 16),
            "canaryLeaked": ms.extraction_test(hardened, ms.EXTRACTION_PROMPT, ms.CANARY),
        },
        "extractionTests": [
            {
                "prompt": p,
                "vulnerableLeaked": ms.extraction_test(vulnerable, p, ms.CANARY),
                "hardenedLeaked": ms.extraction_test(hardened, p, ms.CANARY),
            }
            for p in EXTRACTION_PROMPTS
        ],
        "benign": {"prompt": "the daily report", "output": ms.generate(hardened, "the daily report", 8)},
        "deletion": {
            "userId": "user-00",
            "recordsBefore": len(allowed),
            "recordsAfter": len(remaining),
            "retrainedDocs": retrained["docs"],
        },
        "console": console_of(ms.main),
    }


def memorisation_model():
    data = mlm.create_training_data()
    vulnerable = mlm.train_model(data)
    leaked_before, output_before = mlm.leakage_test(vulnerable)
    cleaned, removed = mlm.deduplicate(data)
    hardened = mlm.train_model(cleaned)
    leaked_after, output_after = mlm.leakage_test(hardened)
    benign_works, benign_output = mlm.benign_pattern_test(hardened)
    return {
        "script": "memorisation_leakage_model.py",
        "author": "Sadhakshi",
        "sha256": sha256("memorisation_leakage_model.py"),
        "records": len(data),
        "vulnerable": {"prompt": mlm.EXTRACTION_PROMPT, "output": output_before, "canaryLeaked": leaked_before},
        "duplicatesRemoved": removed,
        "hardened": {"prompt": mlm.EXTRACTION_PROMPT, "output": output_after, "canaryLeaked": leaked_after},
        "benign": {"prompt": mlm.BENIGN_PROMPT, "output": benign_output, "works": benign_works},
        "verdict": "PASS" if leaked_before and not leaked_after and benign_works else "REVIEW",
        "console": console_of(mlm.main),
    }


def build():
    return {"generator": "artifacts/ai-model/ai_security_report.py", "starterKit": starter_kit(), "memorisation": memorisation_model()}


def main():
    report = build()
    if "--check" in sys.argv:
        committed = json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else None
        if committed != report:
            print(f"{REPORT} is stale: run python artifacts/ai-model/ai_security_report.py and commit the result")
            sys.exit(1)
        print(f"{REPORT.name} matches a fresh run of both PoCs")
        return
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
