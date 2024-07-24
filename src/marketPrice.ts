import { Decimal } from "npm:decimal.js@^10.4.3";

export function priceNotionalInCollateral(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): string {
    return notionalToCollateral({
        marketType: args.marketType,
        notional: "1",
        priceBase: args.priceBase,
    });
}

export function priceCollateralInNotional(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): string {
    return collateralToNotional({
        marketType: args.marketType,
        collateral: "1",
        priceBase: args.priceBase,
    });
}

export function priceUsdInNotional(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    quoteAssetId: string;
    priceUsd: string;
}): string {
    return usdToNotional({
        marketType: args.marketType,
        usd: "1",
        priceBase: args.priceBase,
        quoteAssetId: args.quoteAssetId,
        priceUsd: args.priceUsd,
    });
}

export function priceNotionalInUsd(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    quoteAssetId: string;
    priceUsd: string;
}): string {
    const calculatedPriceUsdInNotional = priceUsdInNotional({
        marketType: args.marketType,
        priceBase: args.priceBase,
        quoteAssetId: args.quoteAssetId,
        priceUsd: args.priceUsd,
    });
    return new Decimal("1").div(calculatedPriceUsdInNotional).toFixed();
}

export function collateralToUsd(args: {
    collateral: string;
    priceUsd: string;
}): string {
    return new Decimal(args.collateral).times(args.priceUsd).toFixed();
}

export function usdToCollateral(args: {
    usd: string;
    priceUsd: string;
}): string {
    const collateral = new Decimal(args.usd).div(args.priceUsd).toFixed();
    return collateral === "Infinity" ? args.usd : collateral;
}

export function usdToNotional(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    usd: string;
    priceBase: string;
    quoteAssetId: string;
    priceUsd: string;
}): string {
    if (args.quoteAssetId === "USD" && args.marketType === "collateral_is_base") {
        return args.usd;
    }
    const collateral = usdToCollateral({
        usd: args.usd,
        priceUsd: args.priceUsd,
    });
    return collateralToNotional({
        marketType: args.marketType,
        collateral,
        priceBase: args.priceBase,
    });
}

export function usdToBase(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    usd: string;
    priceUsd: string;
    quoteAssetId: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        return usdToCollateral({ usd: args.usd, priceUsd: args.priceUsd });
    } else {
        return usdToNotional({
            marketType: args.marketType,
            usd: args.usd,
            priceUsd: args.priceUsd,
            quoteAssetId: args.quoteAssetId,
            priceBase: args.priceBase,
        });
    }
}

export function baseToUsd(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    base: string;
    priceBase: string;
    priceUsd: string;
}): string {
    const collateral = baseToCollateral({
        marketType: args.marketType,
        base: args.base,
        priceBase: args.priceBase,
    });
    return collateralToUsd({
        collateral,
        priceUsd: args.priceUsd,
    });
}

export function baseToCollateral(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    base: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        return args.base;
    } else {
        return baseToQuote({
            base: args.base,
            priceBase: args.priceBase,
        });
    }
}

export function baseToQuote(args: {
    base: string;
    priceBase: string;
}): string {
    return new Decimal(args.base).times(args.priceBase).toFixed();
}

export function quoteToBase(args: {
    quote: string;
    priceBase: string;
}): string {
    const base = new Decimal(args.quote).div(args.priceBase).toFixed();
    return base === "Infinity" ? args.quote : base;
}

export function collateralToBase(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    collateral: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        return args.collateral;
    } else {
        return quoteToBase({ quote: args.collateral, priceBase: args.priceBase });
    }
}

export function collateralToQuote(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    collateral: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        return baseToQuote({ base: args.collateral, priceBase: args.priceBase });
    } else {
        return args.collateral;
    }
}

export function notionalToCollateral(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    notional: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        const collateral = new Decimal(args.notional).div(args.priceBase).toFixed();
        return collateral === "Infinity" ? args.notional : collateral;
    } else {
        return new Decimal(args.notional).times(args.priceBase).toFixed();
    }
}

export function collateralToNotional(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    collateral: string;
    priceBase: string;
}): string {
    if (args.marketType === "collateral_is_base") {
        return new Decimal(args.collateral).times(args.priceBase).toFixed();
    } else {
        const notional = new Decimal(args.collateral).div(args.priceBase).toFixed();
        return notional === "Infinity" ? args.collateral : notional;
    }
}
