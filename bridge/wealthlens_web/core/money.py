"""Money, on the side of the wire that computes it.

An amount never travels without its currency, and amounts of different currencies are never added. Both
rules live in the type so no caller is in a position to break them (data-conventions, ADR-0018).

`Decimal` rather than `float`: these figures are summed across a household and printed as somebody's net
worth, and binary floating point is the wrong instrument for that. WLC stores money as DECIMAL; this keeps
it that way rather than laundering it through a float on the way out.
"""
from __future__ import annotations

import dataclasses
from decimal import Decimal


@dataclasses.dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        if not self.currency:
            raise ValueError("money without a currency is not money — every amount states its unit")

    def as_dict(self) -> dict:
        return {"amount": str(self.amount), "currency": self.currency}


class MixedCurrency(ValueError):
    """A set spanning currencies was asked to produce one number. It cannot, and will not guess."""

    def __init__(self, currencies):
        self.currencies = sorted(set(currencies))
        super().__init__("cannot total across currencies: " + ", ".join(self.currencies))


def total(items) -> Money | None:
    """Sum within one currency, or refuse. None for an empty set — "nothing to add" is not "adds to zero"."""
    items = list(items)
    if not items:
        return None
    currencies = {m.currency for m in items}
    if len(currencies) > 1:
        raise MixedCurrency(currencies)
    return Money(sum((m.amount for m in items), Decimal("0")), currencies.pop())
