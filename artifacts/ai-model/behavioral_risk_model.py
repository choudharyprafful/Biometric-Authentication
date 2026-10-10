def calculate_risk(
    failed_attempts,
    new_device,
    new_location,
    odd_hour
):
    risk = 0

    risk += failed_attempts * 10

    if new_device:
        risk += 25

    if new_location:
        risk += 25

    if odd_hour:
        risk += 20

    return min(risk, 100)


def classify(score):
    if score >= 80:
        return "HIGH"
    if score >= 40:
        return "MEDIUM"
    return "LOW"


def main():

    examples = [
        {
            "name": "Normal Login",
            "failed_attempts": 0,
            "new_device": False,
            "new_location": False,
            "odd_hour": False,
        },
        {
            "name": "Suspicious Login",
            "failed_attempts": 5,
            "new_device": True,
            "new_location": True,
            "odd_hour": True,
        },
    ]

    for e in examples:
        score = calculate_risk(
            e["failed_attempts"],
            e["new_device"],
            e["new_location"],
            e["odd_hour"],
        )

        print("\n" + e["name"])
        print(f"Risk Score: {score}")
        print(f"Level: {classify(score)}")


if __name__ == "__main__":
    main()
