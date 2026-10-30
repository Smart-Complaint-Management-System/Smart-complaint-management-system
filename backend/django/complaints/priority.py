import re

from complaints.models import Complaint, PriorityPolicy


DEFAULT_SIGNALS = {
    "safety_keywords": [
        "exposed wiring",
        "exposed live wiring",
        "exposed wire",
        "exposed electrical wiring",
        "live electrical wiring",
        "electrical wiring",
        "live wire",
        "sparking",
        "electric shock",
        "electrocution",
        "fire",
        "smoke",
        "gas leak",
        "structural collapse",
        "injury",
        "unsafe",
        "dangerous",
    ],
    "affected_users_keywords": ["whole building", "entire floor", "campus-wide", "multiple rooms"],
    "disruption_keywords": ["power outage", "water outage", "network outage", "no power", "no water", "service outage"],
    "urgency_keywords": ["immediate", "immediately", "urgent", "right now", "ongoing", "emergency", "cannot use"],
}


def _matches(text, keywords):
    return [keyword for keyword in keywords if keyword and keyword.casefold() in text]


def _affected_count(text, keywords, cap):
    number_matches = re.findall(r"\b(\d{1,6})\s+(?:people|users|students|residents|staff|rooms)\b", text)
    if number_matches:
        count = max(int(value) for value in number_matches)
        if count >= 50:
            return cap
        if count >= 10:
            return round(cap * 0.75)
        if count >= 2:
            return round(cap * 0.5)
        return round(cap * 0.2)
    if _matches(text, keywords):
        return cap
    if any(word in text for word in ("building", "floor", "campus", "department-wide")):
        return round(cap * 0.75)
    if any(word in text for word in ("classroom", "lab", "corridor", "room")):
        return round(cap * 0.35)
    return 0


def assess_priority(title, description, category, policy=None):
    policy = policy or PriorityPolicy.active()
    text = f"{title} {description} {category}".casefold()
    reasons = []

    safety_hits = _matches(text, policy.safety_keywords or DEFAULT_SIGNALS["safety_keywords"])
    safety_score = policy.safety_weight if safety_hits else 0
    if safety_hits:
        reasons.append(f"Safety risk detected: {', '.join(safety_hits[:3])}.")

    affected_score = _affected_count(
        text,
        policy.affected_users_keywords or DEFAULT_SIGNALS["affected_users_keywords"],
        policy.affected_users_weight,
    )
    if affected_score:
        reasons.append("Multiple people, rooms, or shared facilities may be affected.")

    disruption_hits = _matches(
        text,
        policy.disruption_keywords or DEFAULT_SIGNALS["disruption_keywords"],
    )
    disruption_score = 0
    if disruption_hits:
        disruption_score = policy.service_disruption_weight
        reasons.append(f"Service disruption detected: {', '.join(disruption_hits[:2])}.")
    elif any(word in text for word in ("intermittent", "reduced service", "partially working")):
        disruption_score = round(policy.service_disruption_weight * 0.6)
        reasons.append("Partial service disruption was reported.")

    urgency_hits = _matches(text, policy.urgency_keywords or DEFAULT_SIGNALS["urgency_keywords"])
    urgency_score = policy.urgency_weight if urgency_hits else 0
    if urgency_hits:
        reasons.append("The complaint describes an active or urgent condition.")

    score = min(100, safety_score + affected_score + disruption_score + urgency_score)
    electrical_exposure = category.casefold() == "electrical" and any(
        signal in text for signal in ("wire", "wiring", "electrical panel", "socket", "outlet")
    )
    critical_safety_trigger = bool(safety_hits and (urgency_hits or electrical_exposure))
    if critical_safety_trigger:
        score = max(score, policy.critical_threshold)
        reasons.append("Critical safety trigger applied; this score cannot be lowered automatically.")

    if score >= policy.critical_threshold:
        priority = Complaint.Priority.CRITICAL
    elif score >= policy.high_threshold:
        priority = Complaint.Priority.HIGH
    elif score >= policy.medium_threshold:
        priority = Complaint.Priority.MEDIUM
    else:
        priority = Complaint.Priority.LOW

    if not reasons:
        reasons.append("No high-risk, broad-impact, major-disruption, or urgency signals were detected.")
    return {"score": score, "priority": priority, "reasons": reasons, "critical_safety_trigger": critical_safety_trigger}
