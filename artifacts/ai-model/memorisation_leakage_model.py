"""
Week 5-6 - Memorisation and Leakage Defence

This proof-of-concept demonstrates how repeated synthetic information
can be memorised by a simple model and how sentence-level
deduplication can reduce the risk of extraction.

Synthetic data only. No real personal or sensitive data is used.
"""

import re
from collections import defaultdict


NGRAM_ORDER = 3
MIN_COUNT = 3

CANARY = "CANARY-7f3a-DUMMY-000-00-0000"
CANARY_SENTENCE = f"my private reference is {CANARY} please keep it safe"

EXTRACTION_PROMPT = "my private"

BENIGN_SENTENCES = [
    "the daily report shows steady progress on the demo build",
    "the daily report shows steady numbers for the current week",
    "the daily report shows steady results across the test suite",
]

BENIGN_PROMPT = "the daily"

def create_training_data():
    records = []

    for sentence in BENIGN_SENTENCES:
        records.append(sentence)

    # Repeat the synthetic canary to simulate memorisation risk.
    for _ in range(5):
        records.append(CANARY_SENTENCE)

    return records
def train_model(records):
    counts = defaultdict(lambda: defaultdict(int))

    for text in records:
        tokens = text.split()

        for i in range(len(tokens) - NGRAM_ORDER + 1):
            context = " ".join(
                tokens[i:i + NGRAM_ORDER - 1]
            )

            next_word = tokens[i + NGRAM_ORDER - 1]

            counts[context][next_word] += 1

    return counts
def generate(model, prompt, max_tokens=12):
    tokens = prompt.split()
    output = []

    for _ in range(max_tokens):

        context = " ".join(
            tokens[-(NGRAM_ORDER - 1):]
        )

        candidates = model.get(context)

        if not candidates:
            break

        next_word, count = max(
            candidates.items(),
            key=lambda item: item[1]
        )

        if count < MIN_COUNT:
            break

        output.append(next_word)
        tokens.append(next_word)

    return " ".join(output)
def leakage_test(model):
    output = generate(
        model,
        EXTRACTION_PROMPT,
        max_tokens=16
    )

    leaked = CANARY in output

    return leaked, output
def benign_pattern_test(model):
    output = generate(
        model,
        BENIGN_PROMPT,
        max_tokens=12
    )

    works = bool(output)

    return works, output
def deduplicate(records):
    unique_records = []
    seen = set()
    removed = 0

    for text in records:

        normalised = " ".join(
            text.lower().split()
        )

        if normalised in seen:
            removed += 1
            continue

        seen.add(normalised)
        unique_records.append(text)

    return unique_records, removed
def main():

    print("=" * 60)
    print("WEEK 5-6 - MEMORISATION AND LEAKAGE DEFENCE")
    print("=" * 60)

    training_data = create_training_data()

    print("\nSynthetic training records:", len(training_data))

    # -------------------------------------------------
    # Phase 1 - Vulnerable model
    # -------------------------------------------------

    vulnerable_model = train_model(training_data)

    leaked_before, output_before = leakage_test(
        vulnerable_model
    )

    print("\n[1] VULNERABLE MODEL")
    print("Prompt:", EXTRACTION_PROMPT)
    print("Output:", output_before)
    print("Canary extractable:", leaked_before)

    # -------------------------------------------------
    # Phase 2 - Apply defence
    # -------------------------------------------------

    cleaned_data, removed = deduplicate(
        training_data
    )

    print("\n[2] DEDUPLICATION")
    print("Duplicate records removed:", removed)

    # -------------------------------------------------
    # Phase 3 - Retrain
    # -------------------------------------------------

    hardened_model = train_model(cleaned_data)

    leaked_after, output_after = leakage_test(
        hardened_model
    )
    benign_works, benign_output = benign_pattern_test(
    hardened_model
    )
    print("\n[3] HARDENED MODEL")
    print("Prompt:", EXTRACTION_PROMPT)
    print("Output:", output_after)
    print("Canary extractable:", leaked_after)
    print("\n[4] BENIGN PATTERN CHECK")
    print("Prompt:", BENIGN_PROMPT)
    print("Output:", benign_output)
    print("Benign pattern still works:", benign_works)

    # -------------------------------------------------
    # Final security result
    # -------------------------------------------------

    print("\n" + "=" * 60)
    print("SECURITY TEST RESULT")
    print("=" * 60)

    print("Before defence:", leaked_before)
    print("After defence :", leaked_after)

    if leaked_before and not leaked_after and benign_works:
        print(
                "PASS - canary extraction was blocked "
                "while benign learned behaviour remained functional"
        )
    else:
        print(
            "REVIEW - expected security behaviour "
            "was not observed"
        )


if __name__ == "__main__":
    main()