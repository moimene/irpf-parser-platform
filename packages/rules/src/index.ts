export type AssetKind = "LISTED" | "UNLISTED";

export interface TradeEvent {
  id: string;
  isin: string;
  type: "BUY" | "SELL";
  tradeDate: string;
  quantity: number;
  gainLossEur?: number;
  assetKind: AssetKind;
}

export interface BlockedLoss {
  sellEventId: string;
  blockedByBuyEventId: string;
  windowMonths: number;
  reason: string;
}

export function monthsWindowFor(assetKind: AssetKind): number {
  return assetKind === "LISTED" ? 2 : 12;
}

export function detectBlockedLosses(events: TradeEvent[]): BlockedLoss[] {
  const sellsWithLoss = events.filter(
    (event) => event.type === "SELL" && (event.gainLossEur ?? 0) < 0
  );
  const buys = events.filter((event) => event.type === "BUY");

  return sellsWithLoss.flatMap((sellEvent) => {
    const windowMonths = monthsWindowFor(sellEvent.assetKind);
    const sellDate = new Date(sellEvent.tradeDate);

    const lowerBound = new Date(sellDate);
    lowerBound.setMonth(lowerBound.getMonth() - windowMonths);

    const upperBound = new Date(sellDate);
    upperBound.setMonth(upperBound.getMonth() + windowMonths);

    const blockingBuy = buys.find((buyEvent) => {
      if (buyEvent.isin !== sellEvent.isin) {
        return false;
      }

      const buyDate = new Date(buyEvent.tradeDate);
      return buyDate >= lowerBound && buyDate <= upperBound;
    });

    if (!blockingBuy) {
      return [];
    }

    return [
      {
        sellEventId: sellEvent.id,
        blockedByBuyEventId: blockingBuy.id,
        windowMonths,
        reason: `Perdida bloqueada por recompra de ${sellEvent.isin} en ventana ${windowMonths}m`
      }
    ];
  });
}

export interface FifoLot {
  lotId: string;
  quantity: number;
  unitCost: number;
  acquisitionDate: string;
}

export interface FifoAllocation {
  lotId: string;
  quantity: number;
  unitCost: number;
  acquisitionDate: string;
}

export function allocateSellByFifo(
  lots: FifoLot[],
  quantityToSell: number
): FifoAllocation[] {
  const sortedLots = [...lots].sort(
    (a, b) => new Date(a.acquisitionDate).getTime() - new Date(b.acquisitionDate).getTime()
  );

  let remaining = quantityToSell;
  const allocations: FifoAllocation[] = [];

  for (const lot of sortedLots) {
    if (remaining <= 0) {
      break;
    }

    const qty = Math.min(remaining, lot.quantity);
    if (qty <= 0) {
      continue;
    }

    allocations.push({
      lotId: lot.lotId,
      quantity: qty,
      unitCost: lot.unitCost,
      acquisitionDate: lot.acquisitionDate
    });

    remaining -= qty;
  }

  if (remaining > 0) {
    throw new Error(`FIFO insuficiente: faltan ${remaining} unidades para asignar la venta`);
  }

  return allocations;
}
