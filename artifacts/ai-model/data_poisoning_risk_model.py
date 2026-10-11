"""
Data Poisoning Risk Score
Synthetic AI Security PoC.
"""


def calculate_risk(
    duplicate_records: int,
    single_user_ratio: float,
    canary_frequency: float,
    source_diversity: float,
):
    score = 0

    score += min(duplicate_records * 5, 30)

    if single_user_ratio > 0.5:
        score += 25

    if canary_frequency > 0.2:
        score += 25

    if source_diversity < 0.4:
        score += 20

    return min(score, 100)


def classify(score: int):
    if score >= 80:
        return "HIGH"
    if score >= 40:
        return "MEDIUM"
    return "LOW"


def categorize(
    duplicate_records: int,
    single_user_ratio: float,
    canary_frequency: float,
    source_diversity: float,
):
    categories = []

    if duplicate_records >= 5:
        categories.append("DUPLICATE_DOMINANCE")

    if single_user_ratio > 0.5:
        categories.append("USER_DOMINANCE")

    if canary_frequency > 0.2:
        categories.append("CANARY_CONCENTRATION")

    if source_diversity < 0.4:
        categories.append("LOW_SOURCE_DIVERSITY")

    return categories or ["NONE"]


SCENARIOS = [
    {
        "name": "Normal Training Data",
        "duplicate_records": 1,
        "single_user_ratio": 0.1,
        "canary_frequency": 0.0,
        "source_diversity": 0.9,
    },
    {
        "name": "Moderate Poisoning Risk",
        "duplicate_records": 4,
        "single_user_ratio": 0.4,
        "canary_frequency": 0.1,
        "source_diversity": 0.5,
    },
    {
        "name": "High Poisoning Risk",
        "duplicate_records": 8,
        "single_user_ratio": 0.7,
        "canary_frequency": 0.3,
        "source_diversity": 0.2,
    },
]


def main():
    for scenario in SCENARIOS:
        score = calculate_risk(
            duplicate_records=scenario["duplicate_records"],
            single_user_ratio=scenario["single_user_ratio"],
            canary_frequency=scenario["canary_frequency"],
            source_diversity=scenario["source_diversity"],
        )

        print(
            f'{scenario["name"]} -> '
            f'{score} ({classify(score)})'
        )


if __name__ == "__main__":
    main()