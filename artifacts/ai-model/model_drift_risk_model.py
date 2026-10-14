"""
Model Drift Risk Score
Synthetic AI Security PoC.
"""


def calculate_risk(
    feature_drift: float,
    score_drift: float,
    threshold_shift: float,
    population_shift: float,
):
    score = 0

    if feature_drift > 0.3:
        score += 25

    if score_drift > 0.3:
        score += 25

    if threshold_shift > 0.2:
        score += 25

    if population_shift > 0.3:
        score += 25

    return min(score, 100)


def classify(score: int, categories=None):
    if score >= 80:
        return "HIGH"

    if score >= 40:
        return "MEDIUM"

    if categories and categories != ["NONE"]:
        return "MEDIUM"

    return "LOW"


def categorize(
    feature_drift: float,
    score_drift: float,
    threshold_shift: float,
    population_shift: float,
):
    categories = []

    if feature_drift > 0.3:
        categories.append("FEATURE_DRIFT")

    if score_drift > 0.3:
        categories.append("SCORE_DRIFT")

    if threshold_shift > 0.2:
        categories.append("THRESHOLD_INSTABILITY")

    if population_shift > 0.3:
        categories.append("POPULATION_SHIFT")

    return categories or ["NONE"]


SCENARIOS = [
    {
        "name": "Stable Model",
        "feature_drift": 0.05,
        "score_drift": 0.05,
        "threshold_shift": 0.05,
        "population_shift": 0.05,
    },
    {
        "name": "Moderate Drift",
        "feature_drift": 0.4,
        "score_drift": 0.1,
        "threshold_shift": 0.1,
        "population_shift": 0.1,
    },
    {
        "name": "Severe Drift",
        "feature_drift": 0.5,
        "score_drift": 0.5,
        "threshold_shift": 0.3,
        "population_shift": 0.4,
    },
]


def main():
    for scenario in SCENARIOS:
        score = calculate_risk(
            feature_drift=scenario["feature_drift"],
            score_drift=scenario["score_drift"],
            threshold_shift=scenario["threshold_shift"],
            population_shift=scenario["population_shift"],
        )

        categories = categorize(
            feature_drift=scenario["feature_drift"],
            score_drift=scenario["score_drift"],
            threshold_shift=scenario["threshold_shift"],
            population_shift=scenario["population_shift"],
        )

        print(
            f'{scenario["name"]} -> '
            f'{score} ({classify(score, categories)}) '
            f'{categories}'
        )


if __name__ == "__main__":
    main()