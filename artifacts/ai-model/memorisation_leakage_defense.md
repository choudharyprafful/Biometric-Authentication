# AI/ML Memorisation and Leakage Defence

## Overview

This work focuses on reducing the risk of an AI/ML model memorising and
exposing information from its training data.

For this proof-of-concept, only synthetic data is used. A dummy canary value
is intentionally placed multiple times in the training corpus to simulate
information that could potentially be memorised by a model.

The purpose of the test is to compare the model behaviour before and after
sentence-level deduplication is applied.

## Security Problem

When the same information appears repeatedly in training data, a model may
learn and reproduce that information.

In this proof-of-concept, the synthetic canary is deliberately repeated across
multiple training records. This allows us to safely demonstrate the
memorisation/leakage problem without using any real personal or sensitive data.

## Memorisation Test

The vulnerable model is trained without deduplication.

Test prompt:

`my private`

The vulnerable model generated a continuation containing the synthetic canary.

### Result

`LEAKED - canary extracted`

This demonstrates that repeated training data can become extractable in the
toy model.

## Defence: Sentence-Level Deduplication

Sentence-level deduplication is applied before training the hardened model.

Each sentence is normalised and checked against sentences that have already
been processed. Exact duplicate sentences are removed before the model is
trained.

During the test:

- 4 duplicate sentences were removed.
- The hardened model was retrained using the deduplicated corpus.
- The same extraction prompt was tested again.

### Result

`blocked - canary not extractable`

The hardened model did not reproduce the synthetic canary.

## Functionality After Deduplication

An additional test was performed to confirm that deduplication did not prevent
the model from learning genuine repeated patterns.

Test prompt:

`the daily report`

Output:

`shows steady`

This demonstrates that exact duplicate sentences can be removed while useful
patterns in different training sentences can still be learned.

## Security Controls Demonstrated

The proof-of-concept currently demonstrates:

- Sentence-level deduplication
- Synthetic canary-based leakage testing
- Consent filtering before training
- Per-user contribution limits
- Retraining from a reduced corpus after user deletion

## Test Results

| Test                                     | Result |
| ---------------------------------------- | ------ |
| Canary extractable without deduplication | Yes    |
| Duplicate sentences removed              | 4      |
| Canary extractable after deduplication   | No     |
| Genuine repeated pattern still generated | Yes    |
| Non-consented record blocked             | Yes    |

## Limitations

Sentence-level deduplication is a mitigation and should not be considered a
complete solution to AI/ML memorisation or information leakage.

This proof-of-concept uses a small word-level n-gram model and synthetic data.
The results therefore demonstrate the security concept rather than proving
that the same control will completely prevent memorisation in a production
large language model.

Information that has already been learned by a deployed model also cannot be
assumed to be surgically removed simply by deleting the original training
record. In this proof-of-concept, deletion is demonstrated by removing the
user's records from the corpus and retraining the model.

## Conclusion

The proof-of-concept demonstrates how repeated training information can become
extractable and how sentence-level deduplication can reduce this risk.

Before deduplication, the synthetic canary was extractable. After duplicate
sentences were removed and the model was retrained, the canary was no longer
extractable while a genuine repeated pattern remained functional.
