"""The HTTP layer — a thin shell over `core/`.

Nothing here computes a financial figure. Shaping, aggregation, currency resolution and the honesty rules
all live in `core/`, where a plain function call asserts them (ADR-0018); this package turns them into
responses and enforces the security posture.
"""
